"""maps_point/planegrid.py — N×M grid plane calibration + freehand path
replay.

Teach a grid of physical points (GetPose() → [X,Y,Z,Rx,Ry,Rz], jogged by
hand) on a flat object, then map a freehand-drawn canvas stroke onto that
surface via piecewise-bilinear interpolation across the grid, and replay
it as ONE continuously-blended motion (robot.movl_path(), CR5 queued-move
execution + CP() corner-rounding) rather than stopping fully at every
waypoint.

Math: bilinear interpolation's 4 weights always sum to 1 for any (u,v) —
it's an AFFINE combination of the 4 corner poses, not just a weighted
average. Since an affine combination of points that all lie on the same
plane always stays on that plane (regardless of whether the quad is a
perfect rectangle), any point interpolated from 4 truly coplanar corner
poses lands exactly on the taught plane. A 2×2 grid is exactly the simple
4-corner case; more rows/cols apply this per grid cell instead of once
globally, which tolerates a surface that isn't perfectly flat/rectangular
better than a single 4-point patch — the same idea 3D-printer firmware
uses for bed-leveling mesh compensation.

No camera/vision involved at all here — corners are whatever pose the
user jogged the robot to and pressed "mark" at (see main.py's
/api/grid/mark), unlike align.py's depth-tracked points.
"""
import hashlib
import json
import math
import time

import cv2
import numpy as np

from .config import (
    DRAW_SIMPLIFY_ENABLED, DRAW_SIMPLIFY_EPS,
    DRAW_MAX_POINTS, DRAW_MAX_RMSE_MM, DRAW_MIN_GRID_SPAN_MM,
    DRAW_CP_RATIO, DRAW_PATH_TIMEOUT_PER_POINT_S, STABLE_TIMEOUT,
    DRAW_MOTION_MODE, DRAW_SERVOP_RATE_HZ, DRAW_SERVOP_STEP_MM,
    DRAW_SERVOP_MAX_STREAM_POINTS, DRAW_SERVOP_ERROR_CHECK_S,
    DRAW_SERVOP_SETTLE_S, DRAW_LIFT_MM,
)
from .logs import log
from .robot import Robot, RobotMoveError


def bilinear_cell(lu: float, lv: float, p00, p10, p01, p11) -> list:
    """Interpolate one grid cell. lu,lv are LOCAL fractions (0..1) within
    THIS cell, not global canvas coordinates. p00=top-left, p10=top-right,
    p01=bottom-left, p11=bottom-right, each a 6-element [X,Y,Z,Rx,Ry,Rz].
    Weights (1-lu)(1-lv), lu(1-lv), (1-lu)lv, lu*lv always sum to 1 — see
    module docstring for why this keeps the result on the taught plane."""
    w00 = (1 - lu) * (1 - lv)
    w10 = lu * (1 - lv)
    w01 = (1 - lu) * lv
    w11 = lu * lv
    return [w00 * p00[i] + w10 * p10[i] + w01 * p01[i] + w11 * p11[i] for i in range(6)]


def grid_pose(u: float, v: float, grid_points, rows: int, cols: int) -> list:
    """Map global u,v in [0,1] to an interpolated [X,Y,Z,Rx,Ry,Rz]. Row 0 =
    top = v=0, col 0 = left = u=0 (matches the image/pixel convention used
    elsewhere in this app). Every point in grid_points must already be
    marked (not None) — callers check this before drawing, not this
    function (see main.py's /api/draw)."""
    col_f = min(max(u, 0.0), 1.0) * (cols - 1)
    row_f = min(max(v, 0.0), 1.0) * (rows - 1)
    j = min(max(int(math.floor(col_f)), 0), cols - 2)
    i = min(max(int(math.floor(row_f)), 0), rows - 2)
    lu = col_f - j
    lv = row_f - i
    p00 = grid_points[i][j]
    p10 = grid_points[i][j + 1]
    p01 = grid_points[i + 1][j]
    p11 = grid_points[i + 1][j + 1]
    return bilinear_cell(lu, lv, p00, p10, p01, p11)


def _fit_plane(pts_xyz):
    """Shared least-squares plane fit via SVD: centroid + orthonormal
    basis (e_u, e_v spanning the plane, normal perpendicular to it).
    Used by both validate_grid (RMSE against `normal`) and
    project_grid_2d (2D coords along `e_u`/`e_v`)."""
    pts = np.array(pts_xyz, dtype=float)
    centroid = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - centroid)
    e_u, e_v, normal = vt[0], vt[1], vt[2]
    return centroid, e_u, e_v, normal


def validate_grid(grid_points, rows: int, cols: int) -> dict:
    """Sanity check once the whole grid is marked — least-squares plane
    fit through all rows*cols XYZ points, RMSE against it. This is
    teach-accuracy noise (how precisely the points were jogged by hand),
    not vision noise like align.py's plane-fit guard, but the same
    "warn, don't silently refuse a real workpiece" spirit: returns
    warnings, doesn't raise. Caller (main.py) decides whether to still
    allow drawing."""
    flat = [grid_points[i][j][:3] for i in range(rows) for j in range(cols)]
    centroid, _, _, normal = _fit_plane(flat)
    pts = np.array(flat, dtype=float)
    dists = (pts - centroid) @ normal
    rmse_mm = float(np.sqrt(np.mean(dists ** 2)))

    warnings = []
    span_mm = max(max(p[k] for p in flat) - min(p[k] for p in flat) for k in range(3))
    if span_mm < DRAW_MIN_GRID_SPAN_MM:
        warnings.append(f"grid has no size (span={span_mm:.2f}mm) — "
                         f"jog to each corner before marking")
    if rmse_mm > DRAW_MAX_RMSE_MM:
        warnings.append(f"grid points aren't very coplanar (rmse={rmse_mm:.2f}mm > "
                         f"{DRAW_MAX_RMSE_MM:.1f}mm) — check for a mis-taught point")
    return {"rmse_mm": rmse_mm, "span_mm": span_mm, "warnings": warnings}


def project_grid_2d(grid_points, rows: int, cols: int) -> list:
    """Project each taught grid point's XYZ onto the fitted plane's own
    in-plane 2D basis (e_u, e_v) — a 2D shape that reflects the TRUE
    physical proportions/skew of the taught quadrilateral (unlike
    plotting raw robot X,Y, which wouldn't line up with the object's own
    orientation if it isn't axis-aligned in the robot frame). Used to
    render a visual sanity-check of the taught grid before drawing on it
    (see main.py's /api/status `grid_shape_2d`). Returns a [row][col]
    nested list of (u_mm, v_mm) tuples, in mm from the grid's centroid.

    SVD's e_u/e_v have an arbitrary sign/order — flipped here so
    increasing row/col roughly matches increasing v/u, purely so the
    rendered preview isn't randomly mirrored/rotated relative to how the
    grid was actually taught (row 0 = top, col 0 = left elsewhere in this
    app)."""
    flat = [grid_points[i][j][:3] for i in range(rows) for j in range(cols)]
    centroid, e_u, e_v, _ = _fit_plane(flat)

    row0 = np.array(grid_points[0][0][:3]) - centroid
    rowN = np.array(grid_points[rows - 1][0][:3]) - centroid
    if (rowN - row0) @ e_v < 0:
        e_v = -e_v
    col0 = np.array(grid_points[0][0][:3]) - centroid
    colN = np.array(grid_points[0][cols - 1][:3]) - centroid
    if (colN - col0) @ e_u < 0:
        e_u = -e_u

    out = []
    for i in range(rows):
        row = []
        for j in range(cols):
            p = np.array(grid_points[i][j][:3], dtype=float) - centroid
            row.append((float(p @ e_u), float(p @ e_v)))
        out.append(row)
    return out


def _as_uv_list(points) -> list:
    return [(float(u), float(v)) for u, v in points]


def _cap_points(points_uv, max_points: int) -> list:
    """Uniformly downsample to at most max_points, preserving endpoints —
    shared tail end of simplify_stroke() (below) and the pass-through path
    for programmatically-generated shapes (_stroke_to_poses()) that skip
    simplification entirely."""
    if len(points_uv) <= max_points:
        return [(float(u), float(v)) for u, v in points_uv]
    idx = np.linspace(0, len(points_uv) - 1, max_points).round().astype(int)
    return [(float(points_uv[i][0]), float(points_uv[i][1])) for i in idx]


def simplify_stroke(points_uv, eps: float = DRAW_SIMPLIFY_EPS) -> list:
    """Reduce a dense freehand PEN stroke (list of (u,v) in [0,1], possibly
    hundreds of raw mousemove samples) to a smaller set of waypoints via
    cv2.approxPolyDP (Douglas-Peucker), so do_draw isn't sending a
    blocking robot.movl() for every single mouse sample. Hard-capped at
    DRAW_MAX_POINTS afterward (uniform downsample if still over) so one
    scribble can't queue an unbounded number of blocking moves.

    Only for the "pen" tool — see _stroke_to_poses(), which skips this
    entirely for programmatically-generated shapes (line/rect/triangle/circle):
    Douglas-Peucker would happily collapse a circle's ~36 evenly-spaced
    points down to a handful of vertices (each point's deviation from its
    neighbors' chord is tiny for a smooth curve, exactly what eps is
    designed to discard), turning a circle back into a visibly-faceted
    polygon — the same "not detailed enough" complaint that motivated
    ServoP streaming in the first place, reintroduced through a different
    path if this function were applied unconditionally.

    DP only runs when the stroke is OVER the cap — a short stroke (e.g. 29
    samples) is already under it, and running DP anyway collapses it to a
    2-point straight line, which is how a drawn shape silently became "the
    arm just went down and didn't trace anything" on hardware. The <3
    fallback guards the over-cap case against the same total collapse.

    DRAW_SIMPLIFY_ENABLED=0 passes every raw sample straight through — no
    Douglas-Peucker and no uniform downsample — so the arm traces the outline
    that was actually drawn instead of a reduced stand-in. It is the knob for
    when fidelity matters more than move count. Neither DRAW_SIMPLIFY_EPS nor
    DRAW_MAX_POINTS applies while it is off; in "servo" mode the bound then
    comes from densify_path()'s DRAW_SERVOP_MAX_STREAM_POINTS, which is a
    cap on the stream rather than a change to the shape."""
    if not DRAW_SIMPLIFY_ENABLED:
        return _as_uv_list(points_uv)
    if len(points_uv) <= 2:
        return list(points_uv)
    if len(points_uv) <= DRAW_MAX_POINTS:
        return _cap_points(points_uv, DRAW_MAX_POINTS)
    arr = np.array(points_uv, dtype=np.float32).reshape(-1, 1, 2)
    simplified = cv2.approxPolyDP(arr, eps, closed=False).reshape(-1, 2).tolist()
    if len(simplified) < 3:
        return _cap_points(points_uv, DRAW_MAX_POINTS)
    return _cap_points(simplified, DRAW_MAX_POINTS)


# uv tolerance for calling a stroke "closed". Matches the 4-decimal precision
# every uv is reported at, so a stroke counts as closed exactly when its
# printed endpoints are identical.
_UV_CLOSED_EPS = 1e-4

# A pose read is rejected once it sits further from the taught grid's centre
# than the grid's own diameter plus this slack. Generous on purpose: it must
# catch garbage and wrong-frame reads, never a real large error.
_POSE_SANITY_SLACK_MM = 1000.0

# Grid Mapping test points the experiment form's rows 40-44 expect. Mirrors
# TEST_POINT_POSITIONS in the Draw page; only the UI knows that canonical
# list, so it is what gates the download on actually covering all of them.
TEST_POINTS_EXPECTED = 5

# The canonical web positions those rows are measured at. Single source of
# truth: do_verify_grid() walks exactly this list and /test-report hands the
# same list to the UI, so the gate can never demand a position the verifier
# does not visit. The four taught corners are deliberately absent — the grid
# predicts those exactly, so their error is zero by construction and testing
# them proves nothing.
GRID_TEST_POSITIONS = [
    {"u": 0.25, "v": 0.5, "label": "ซ้ายกลาง"},
    {"u": 0.5, "v": 0.25, "label": "บนกลาง"},
    {"u": 0.5, "v": 0.5, "label": "กลาง"},
    {"u": 0.5, "v": 0.75, "label": "ล่างกลาง"},
    {"u": 0.75, "v": 0.5, "label": "ขวากลาง"},
]


def _stroke_path(stroke: dict) -> list:
    """The (u,v) points actually replayed for one canvas stroke.

    Single source of truth for the simplify-vs-cap decision: "pen" (noisy
    freehand mousemove samples) goes through simplify_stroke(), while every
    programmatically-generated shape is only hard-capped, because
    Douglas-Peucker would facet a smooth curve back into a polygon — see
    simplify_stroke()'s docstring for the full reasoning.

    With DRAW_SIMPLIFY_ENABLED=0 none of that applies and every raw sample is
    replayed, for shapes and pen alike.

    draw_stats(), _stroke_to_poses() and the draw-end accuracy check all
    route through here so a number in the experiment report can never
    describe a different point list than the one the arm followed. When the
    Draw page hardcoded tool:"pen" for every shape, this branch silently
    became dead code and the report claimed five rectangles were freehand.
    """
    pts = stroke.get("points") or []
    if not DRAW_SIMPLIFY_ENABLED:
        return _as_uv_list(pts)
    if stroke.get("tool") == "pen":
        return simplify_stroke(pts)
    return _cap_points(pts, DRAW_MAX_POINTS)


def grid_fingerprint(grid_points) -> str:
    """Short stable id for one taught grid, so a recorded measurement can be
    traced back to the exact corners it was computed against.

    Rounded before hashing because grid_points round-trip through a JSON
    snapshot on save/load — hashing raw floats would make the same physical
    grid fingerprint differently after a restart and every pre-restart test
    point would then look stale.
    """
    rounded = [[[round(float(c), 4) for c in point] if point else None
                for point in row] for row in grid_points]
    payload = json.dumps(rounded, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:8]


def test_aggregates(points: list) -> dict:
    """Rows 40-44 of the Grid Mapping sheet (Maximum Error X/Y/Z, Mean Error,
    RMSE) computed from the recorded test points.

    Error is one-sided on purpose — computed minus actual — so a positive
    number always means "the grid predicts the tool further out than where it
    really was", which is the direction that matters when deciding whether the
    taught plane or the jogging was off. Rows carrying no `error` key are
    skipped rather than counted as zero, so a partial run can never present
    itself as a perfect one.

    rmse is the standard root-mean-square of the 3D error magnitudes,
    sqrt(mean(d^2)) — the same convention validate_grid()'s rmse_mm uses.
    Dividing by 3n instead of n would report a value 1/sqrt(3) too small
    under the same name, which is how it used to behave here."""
    rows = [p for p in points if p.get("error")]
    if not rows:
        return {"count": 0, "max_error_x": None, "max_error_y": None,
                "max_error_z": None, "mean_error_x": None, "mean_error_y": None,
                "mean_error_z": None, "mean_error": None, "rmse": None}
    errs = [p["error"] for p in rows]
    dist = [math.sqrt(sum(c * c for c in e)) for e in errs]
    n = len(rows)
    return {
        "count": n,
        "max_error_x": max(abs(e[0]) for e in errs),
        "max_error_y": max(abs(e[1]) for e in errs),
        "max_error_z": max(abs(e[2]) for e in errs),
        "mean_error_x": sum(e[0] for e in errs) / n,
        "mean_error_y": sum(e[1] for e in errs) / n,
        "mean_error_z": sum(e[2] for e in errs) / n,
        "mean_error": sum(dist) / n,
        "rmse": math.sqrt(sum(d * d for d in dist) / n),
    }


def build_test_report_payload(grid_points, rows: int, cols: int, grid_marked: bool,
                              test_points: list, draw_stats: dict,
                              tester, generated_at: str) -> dict:
    """Assemble the whole experiment-record download payload.

    Pure so the contract can be tested without importing the HTTP layer —
    mapcontrol pulls in sqlalchemy at module scope, which makes anything
    reached through it untestable on a machine that only has the geometry
    dependencies installed. `api_test_report` is a thin wrapper that supplies
    live state and this returns the bytes.
    """
    stats = draw_stats or {}
    validate = validate_grid(grid_points, rows, cols) if grid_marked else None
    missing = report_missing_codes(grid_marked, grid_points, test_points, stats)
    fingerprint = grid_fingerprint(grid_points)
    recorded = len(test_points)
    marked_count = (rows * cols if grid_marked else
                    sum(1 for i in range(rows) for j in range(cols)
                        if grid_points[i][j] is not None))
    return {
        "generated_at": generated_at,
        "tester": tester,
        "complete": not missing,
        "missing": missing,
        "sheet_05_grid_mapping": {
            "grid_size": f"{rows}x{cols}",
            "grid_rows": rows,
            "grid_cols": cols,
            "reference_point_count": marked_count,
            "grid_points": grid_points if grid_marked else None,
            "plane_rmse_mm": validate["rmse_mm"] if validate else None,
            "area_span_mm": validate["span_mm"] if validate else None,
            "grid_warnings": validate["warnings"] if validate else None,
            "test_points": test_points,
            "aggregates": test_aggregates(test_points),
            "grid_fingerprint": fingerprint,
            "test_points_expected": TEST_POINTS_EXPECTED,
            "test_points_recorded": recorded,
            "test_points_status": ("not_recorded" if not recorded else
                                   "complete" if recorded >= TEST_POINTS_EXPECTED
                                   else "partial"),
            # Shipped so the download gate checks coverage against the same
            # list do_verify_grid() walks, not a second copy that can drift.
            "test_positions": GRID_TEST_POSITIONS,
        },
        "sheet_09_drawing": {
            "grid_size": f"{rows}x{cols}",
            "stroke_count": stats.get("strokes"),
            "points_before_reduction": stats.get("points_before"),
            "points_after_reduction": stats.get("points_after"),
            "waypoints_3d_path": stats.get("waypoints"),
            "path_length_mm": stats.get("path_length_mm"),
            "total_travel_mm": stats.get("total_travel_mm"),
            "drawn_path_length_mm": stats.get("drawn_path_length_mm"),
            "per_stroke": stats.get("per_stroke"),
            # Orientation is excluded from every error figure here: all four
            # taught corners carry identical Rx/Ry/Rz, so it holds no
            # grid-mapping information to measure.
            "draw_end_check": stats.get("draw_end_check"),
            "execution": {k: stats.get(k) for k in
                          ("motion_mode", "cp_ratio", "lift_mm", "lift_transitions",
                           "simplify_enabled", "simplify_eps", "max_points")},
            "result": stats.get("result"),
        },
    }


def report_missing_codes(grid_marked: bool, grid_points, test_points,
                         draw_stats) -> list:
    """Which inputs the experiment record is still missing, as stable codes.

    A pure function so it is unit-testable without the HTTP layer. Kept out
    of the endpoint because mapcontrol imports sqlalchemy at module scope,
    which makes anything reached through it untestable on a machine that
    only has the geometry dependencies installed.

    The 2026-10-05 capture came back with test_points: [] and every aggregate
    null while saying nothing about which it meant, so an unfinished run was
    indistinguishable from a broken one.
    """
    codes = []
    if not grid_marked:
        codes.append("grid_not_marked")
    if not test_points:
        codes.append("no_test_points")
    if not draw_stats:
        codes.append("no_draw_stats")
    elif any(p.get("grid_fingerprint") != grid_fingerprint(grid_points)
             for p in test_points):
        # Grid re-taught after measuring: those errors were computed against
        # corners that no longer exist.
        codes.append("grid_changed_since_test")
    return codes


def parse_measured_pose(raw):
    """Validate an operator-supplied measured pose. Returns (values, error).

    On this controller GetPose() has been observed echoing the last commanded
    Cartesian target, so the Grid Mapping form's "actual robot pose" column
    can only be filled from a measurement the operator makes themselves. That
    makes this the one place untrusted free-text numbers enter an experiment
    form, so it refuses anything it cannot turn into exactly three finite
    numbers rather than coercing it.

    `raw is None` means "no measurement supplied" and is not an error — the
    caller then falls back to reading the robot.
    """
    if raw is None:
        return None, None
    if not isinstance(raw, list) or len(raw) < 3:
        return None, "actual must be [x, y, z]"
    try:
        values = [float(c) for c in raw[:3]]
    except (TypeError, ValueError):
        return None, "actual must be three numbers"
    if any(math.isnan(c) or math.isinf(c) for c in values):
        return None, "actual must be finite numbers"
    return values, None


def pose_read_is_plausible(actual, grid_points) -> bool:
    """Whether a pose read back from the controller may be trusted AS A
    MEASUREMENT.

    robot.get_pose() never raises — it returns [0.0]*6 for any dashboard
    failure at all (robot.py:160-168). A caller that doesn't check will
    cheerfully record an error of several hundred millimetres from a dropped
    socket, and a wrong number in a thesis experiment form is far worse than
    a missing one: once aggregated into Max/RMSE it is indistinguishable
    from a real calibration failure. This is why both /grid/test-point and
    the draw-end check below go through here.

    Rejects the exact all-zero sentinel, non-finite coordinates, and any pose
    further from the taught grid than the grid's own diameter plus generous
    slack — the latter also catches a read taken in the wrong Tool frame,
    which robot.py:170-194 records as having produced a 107mm/156° jump.
    Everything else is accepted: this guards against garbage, not against
    large-but-real errors.
    """
    if not actual or len(actual) < 3:
        return False
    xyz = list(actual[:3])
    if xyz == [0.0, 0.0, 0.0]:
        return False
    if any(not math.isfinite(c) for c in xyz):
        return False
    corners = [point[:3] for row in grid_points for point in row if point]
    if not corners:
        return False
    centre = [sum(c[i] for c in corners) / len(corners) for i in range(3)]
    span = max(math.dist(a, b) for a in corners for b in corners)
    return math.dist(xyz, centre) <= span + _POSE_SANITY_SLACK_MM


def _final_stroke_uv(strokes: list, grid_points, rows: int, cols: int):
    """uv of the point that actually produced the last assembled pose, or
    None when no stroke contributes anything.

    Cannot simply read strokes[-1]: _assemble_strokes() skips strokes whose
    simplified path is empty (`if not pts: continue`), so the last element of
    `strokes` need not be the last contributor to `poses`. Walking backwards
    with the same path helper _assemble_strokes() uses keeps the recorded
    label and the compared pose describing the same physical location — a
    mismatch would put a u/v on the record that never went where the error
    was measured.
    """
    for stroke in reversed(strokes):
        path = _stroke_path(stroke)
        if path:
            return path[-1]
    return None


def draw_stats(strokes: list, grid_points, rows: int, cols: int,
               lift_mm: float) -> dict:
    """Non-moving summary of one draw request: raw canvas samples in,
    waypoints out, and the assembled 3D path length.

    Runs the SAME simplify_stroke()/_cap_points()/_assemble_strokes() chain
    do_draw() replays, so the numbers recorded in the experiment form come
    from the real code path rather than a re-implementation that could drift
    from it. `api_draw` calls this before handing the work to the thread."""
    per_stroke, before, after = [], 0, 0
    drawn_mm = 0.0
    for s in strokes:
        pts = s.get("points") or []
        path = _stroke_path(s)
        before += len(pts)
        after += len(path)
        entry = {"tool": s.get("tool", "pen"), "points_before": len(pts),
                 "points_after": len(path)}
        if path:
            ends = [grid_pose(u, v, grid_points, rows, cols)
                    for u, v in (path[0], path[-1])]
            entry["uv_start"] = [round(path[0][0], 4), round(path[0][1], 4)]
            entry["uv_end"] = [round(path[-1][0], 4), round(path[-1][1], 4)]
            entry["xyz_start"] = [round(c, 2) for c in ends[0][:3]]
            entry["xyz_end"] = [round(c, 2) for c in ends[1][:3]]
            # `closed` separates a deliberately-closed shape from a corrupt
            # record — the Draw page's rectangles repeat their 1st vertex as
            # the 5th, so uv_start == uv_end is correct, but read alone on
            # 2026-10-05 it looked like five broken strokes.
            entry["closed"] = (abs(path[0][0] - path[-1][0]) <= _UV_CLOSED_EPS
                               and abs(path[0][1] - path[-1][1]) <= _UV_CLOSED_EPS)
            entry["points_uv"] = [[round(u, 4), round(v, 4)] for u, v in path]
            xyz = [grid_pose(u, v, grid_points, rows, cols)[:3] for u, v in path]
            entry["length_mm"] = round(sum(math.dist(a, b)
                                           for a, b in zip(xyz, xyz[1:])), 2)
            entry["span_mm"] = {
                axis: round(max(p[i] for p in xyz) - min(p[i] for p in xyz), 2)
                for i, axis in enumerate(("x", "y", "z"))}
            drawn_mm += entry["length_mm"]
        per_stroke.append(entry)
    poses = _assemble_strokes(strokes, grid_points, rows, cols, lift_mm)
    travel_mm = sum(math.dist(a[:3], b[:3]) for a, b in zip(poses, poses[1:]))
    return {"strokes": len(strokes), "points_before": before, "points_after": after,
            "per_stroke": per_stroke, "waypoints": len(poses),
            # Travel includes the pen-lift hops between strokes, drawn does not.
            "path_length_mm": round(travel_mm, 2),
            "total_travel_mm": round(travel_mm, 2),
            "drawn_path_length_mm": round(drawn_mm, 2),
            "lift_transitions": max(0, len(strokes) - 1), "lift_mm": lift_mm,
            "motion_mode": DRAW_MOTION_MODE, "cp_ratio": DRAW_CP_RATIO,
            "simplify_enabled": DRAW_SIMPLIFY_ENABLED,
            "simplify_eps": DRAW_SIMPLIFY_EPS, "max_points": DRAW_MAX_POINTS}


def densify_path(poses: list, step_mm: float, max_points: int) -> list:
    """Linearly interpolate a sparse sequence of Cartesian
    [X,Y,Z,Rx,Ry,Rz] waypoints so consecutive points are at most
    `step_mm` apart in XYZ — feeds robot.servo_stream()'s ServoP
    "dynamic follow" mode, which (unlike movl_path()'s CP) has no
    corner-blend or trajectory planning of its own: smoothness comes
    entirely from calling it often enough with closely-spaced targets.
    Rotation is interpolated linearly alongside position using the same
    per-segment fraction — fine here since a freehand stroke stays on one
    taught plane and consecutive waypoints' orientation barely changes
    (unlike align's large multi-axis rotations, where linear Euler
    interpolation wouldn't be valid).

    Hard-capped at max_points (uniformly downsampled, same fallback style
    as simplify_stroke()) so a long stroke with far-apart simplified
    waypoints can't demand an unbounded stream length/duration."""
    if len(poses) < 2:
        return [list(p) for p in poses]
    dense = [list(poses[0])]
    for a, b in zip(poses, poses[1:]):
        dist  = math.dist(a[:3], b[:3])
        steps = max(1, math.ceil(dist / step_mm))
        for s in range(1, steps + 1):
            f = s / steps
            dense.append([a[i] + (b[i] - a[i]) * f for i in range(6)])
    if len(dense) > max_points:
        idx = np.linspace(0, len(dense) - 1, max_points).round().astype(int)
        dense = [dense[i] for i in idx]
    return dense


def _stroke_to_poses(stroke: dict, grid_points, rows: int, cols: int) -> list:
    """One entry from the Draw canvas's `strokes` payload (static/draw.js)
    — {"tool": "pen"|"line"|"rect"|"triangle"|"circle", "points": [(u,v), ...]} —
    mapped through the taught grid to Cartesian [X,Y,Z,Rx,Ry,Rz]
    waypoints. Which point list gets replayed is _stroke_path()'s decision,
    not this function's."""
    return [grid_pose(u, v, grid_points, rows, cols)
            for u, v in _stroke_path(stroke)]


def _assemble_strokes(strokes: list, grid_points, rows: int, cols: int, lift_mm: float) -> list:
    """Concatenate multiple strokes/shapes into ONE Cartesian path,
    inserting a pen-lift-travel-descend transition (DRAW_LIFT_MM) between
    strokes so the robot doesn't drag across the surface from one shape's
    end to the next shape's start. The transition is just 2 extra poses
    (lift at the previous end, travel while lifted to above the next
    start) — the next stroke's own first point provides the descend, no
    extra pose needed for that. Both execution modes in do_draw() treat
    the result as one plain pose list (CP blends its corners same as any
    other waypoint; servo densify_path() interpolates through it same as
    any other segment) — no special-casing needed beyond building the
    list this way.

    Only transitions BETWEEN strokes are added here. The initial lift and
    approach to the first point are handled by do_draw() before path replay."""
    poses: list = []
    for stroke in strokes:
        pts = _stroke_to_poses(stroke, grid_points, rows, cols)
        if not pts:
            continue
        if poses:
            lifted_prev  = list(poses[-1]); lifted_prev[2]  += lift_mm
            lifted_start = list(pts[0]);    lifted_start[2] += lift_mm
            poses.extend([lifted_prev, lifted_start])
        poses.extend(pts)
    return poses


def _return_to_start(robot: Robot, state, start_pose) -> None:
    """Lift, travel back above the pose the arm had when the draw began, then
    settle onto it — without this the arm parks on the last stroke point.
    Each leg checks Stop so a mid-return abort actually halts."""
    try:
        robot.ensure_frame()
        cur = robot.get_pose()
        robot.movl(cur[0], cur[1], cur[2] + DRAW_LIFT_MM, cur[3], cur[4], cur[5])
        if state.draw_stop.is_set():
            return
        robot.movl(start_pose[0], start_pose[1], start_pose[2] + DRAW_LIFT_MM,
                   start_pose[3], start_pose[4], start_pose[5])
        if state.draw_stop.is_set():
            return
        robot.movl(*start_pose)
        log("  [Draw] returned to start pose")
    except RobotMoveError as e:
        state.status = f"draw done — return to start failed: {e}"
        log(f"  [Draw] {state.status}")


def do_verify_grid(robot: Robot, state) -> None:
    """Walk the arm to every GRID_TEST_POSITIONS entry and record what the
    taught grid predicts there against where the arm actually ended up —
    the five rows the Grid Mapping sheet needs for its error table.

    Deliberately borrows draw_running/draw_stop instead of a flag of its own:
    that way E-Stop, the jog rejection and the draw-stop button all cover
    this run with no new state to keep in sync. Each point is approached the
    same way do_draw() approaches its first waypoint — lift straight up,
    travel above the target, descend — because that sequence is the one
    already exercised on hardware.

    Each record is independent: a rejected pose read leaves that row empty
    rather than writing a wrong number into the experiment form.
    """
    if state.align_running or state.draw_running:
        state.status = "verify: robot busy"
        return
    if not robot.connected:
        state.status = "verify: robot not connected"
        return
    rows, cols = state.grid_rows, state.grid_cols
    if any(state.grid_points[i][j] is None for i in range(rows) for j in range(cols)):
        state.status = "verify: grid not fully marked"
        return

    state.draw_running = True
    state.draw_stop.clear()
    state.test_points = []
    fingerprint = grid_fingerprint(state.grid_points)
    try:
        robot.ensure_frame()
        start_pose = robot.get_pose()
        if not pose_read_is_plausible(start_pose, state.grid_points):
            state.status = "verify: current pose unreadable — aborted"
            return

        for i, pos in enumerate(GRID_TEST_POSITIONS, start=1):
            if state.draw_stop.is_set():
                state.status = f"verify aborted at {i - 1}/{len(GRID_TEST_POSITIONS)}"
                log(f"  [Verify] {state.status}")
                return
            target = grid_pose(pos["u"], pos["v"], state.grid_points, rows, cols)
            rot = list(target[3:])
            above = list(target[:3])
            above[2] += DRAW_LIFT_MM
            cur = robot.get_pose()
            lifted = list(cur[:3])
            lifted[2] += DRAW_LIFT_MM
            state.status = f"verify {i}/{len(GRID_TEST_POSITIONS)} — {pos['label']}…"
            log(f"  [Verify] {state.status}")
            # Same shape as do_draw()'s approach: straight up, across above
            # the target, then down onto it.
            for move in (lifted + list(cur[3:]), above + rot, list(target)):
                if state.draw_stop.is_set():
                    state.status = f"verify aborted at {i - 1}/{len(GRID_TEST_POSITIONS)}"
                    log(f"  [Verify] {state.status}")
                    return
                robot.movl(*move)

            actual = robot.get_pose()
            if not pose_read_is_plausible(actual, state.grid_points):
                log(f"  [Verify] {pos['label']}: implausible pose read, row left empty")
                continue
            actual = [float(c) for c in actual[:3]]
            err = [target[axis] - actual[axis] for axis in range(3)]
            state.test_points.append({
                "index": len(state.test_points) + 1,
                "label": pos["label"],
                "u": pos["u"], "v": pos["v"],
                "computed": [round(c, 2) for c in target[:3]],
                "actual": [round(a, 2) for a in actual],
                "error": [round(e, 3) for e in err],
                "deviation_mm": round(math.sqrt(sum(e * e for e in err)), 3),
                "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "source": "verify",
                "grid_fingerprint": fingerprint,
            })
            log(f"  [Verify] {pos['label']}: dev="
                f"{state.test_points[-1]['deviation_mm']}mm")

        state.status = (f"verify done — {len(state.test_points)}/"
                        f"{len(GRID_TEST_POSITIONS)} points recorded")
        log(f"  [Verify] {state.status}")
        _return_to_start(robot, state, start_pose)
    except RobotMoveError as e:
        state.status = f"verify: robot rejected a move — {e} — aborted"
        log(f"  [Verify] {state.status}")
    finally:
        state.draw_running = False


def _abort_before_stroke(state, phase: str) -> bool:
    if not state.draw_stop.is_set():
        return False
    state.status = f"draw aborted during {phase}"
    log(f"  [Draw] {state.status}")
    _notify_draw_done(state, "abort", f"stopped during {phase}")
    return True


def do_draw(robot: Robot, state, strokes: list) -> None:
    """Background-thread action (see main.py's /api/draw) — `strokes` is a
    list of {"tool": "pen"|"line"|"rect"|"triangle"|"circle", "points": [(u,v), ...]}
    dicts, one per pen-down-to-pen-up drag on the Draw canvas (static/
    draw.js — added 2026-08-16 alongside the dedicated Draw page,
    replacing the old single-stroke-only canvas embedded in the Align
    page). _assemble_strokes() concatenates all of them into ONE
    Cartesian path with a pen-lift transition between strokes
    (DRAW_LIFT_MM), then that single path is replayed via whichever
    execution model DRAW_MOTION_MODE selects — multiple shapes are still
    ONE background run/ONE robot motion, not one per stroke, so Stop
    aborts the whole thing at any point and neither execution mode below
    needs special-casing for "more than one shape". `state` is
    intentionally untyped (align.AppState) to avoid importing align.py
    here, same reasoning as motion.do_goto.

    - "cp"    robot.movl_path() — CR5 queued-move execution + CP()
              corner-rounding (DRAW_CP_RATIO), not point-to-point
              stop-and-settle at every waypoint, but still fundamentally
              a burst of MovL points — a low waypoint count (post-
              simplify) visibly looks like straight segments.
    - "servo" densify_path() first (spaces waypoints down to
              DRAW_SERVOP_STEP_MM apart), then robot.servo_stream() — true
              continuous "dynamic follow" motion via back-to-back ServoP
              calls at DRAW_SERVOP_RATE_HZ. No corner-blend of its own;
              smoothness comes from the dense spacing + steady rate
              instead. Added 2026-08-16 at the user's request (the CP
              path's post-simplify waypoints looked too much like
              straight-line segments, not detailed enough) — see
              CLAUDE.md's Draw section.

    Both pass state.draw_stop through as a plain callable
    (state.draw_stop.is_set) so the Stop button can actually halt
    in-flight motion (robot.clear_error(), i.e. ResetRobot() — the
    documented 'robot stop' command), not just stop this Python loop from
    sending more while the controller keeps executing something already
    queued/in-flight unattended.

    UNVERIFIED ON REAL HARDWARE as of 2026-08-16 for BOTH modes — "cp"
    since 2026-08-12 (queued MovL bursts instead of one-at-a-time with a
    wait between each), "servo" is newer still (ServoP streaming has
    never been used in this app before). Test cautiously: smallest grid
    (2x2), a short/simple stroke first, watch closely, ready to hit Stop
    — per this project's own established culture (see CLAUDE.md's
    hardware-gotcha history: nothing involving real robot motion here has
    worked correctly on the very first try)."""
    if state.align_running or state.draw_running:
        state.status = "draw: robot busy (align or draw already running)"
        return
    if not robot.connected:
        state.status = "draw: robot not ready"
        return
    rows, cols = state.grid_rows, state.grid_cols
    if any(state.grid_points[i][j] is None for i in range(rows) for j in range(cols)):
        state.status = "draw: grid not fully marked"
        return
    if not strokes:
        state.status = "draw: empty stroke"
        return

    state.draw_running = True
    state.draw_stop.clear()
    try:
        poses = _assemble_strokes(strokes, state.grid_points, rows, cols, DRAW_LIFT_MM)
        if not poses:
            state.status = "draw: empty stroke"
            return
        robot.ensure_frame()
        start_pose = robot.get_pose()

        approach_pose = list(start_pose)
        approach_pose[2] += DRAW_LIFT_MM
        first_pose = list(poses[0])
        above_first_pose = list(first_pose)
        above_first_pose[2] += DRAW_LIFT_MM
        approach_steps = (
            ("lifting from current pose", approach_pose),
            ("moving above first point", above_first_pose),
            ("lowering to first point", first_pose),
        )
        for phase, pose in approach_steps:
            state.status = f"draw: {phase}…"
            log(f"  [Draw] {state.status}")
            robot.movl(*pose)
            if _abort_before_stroke(state, phase):
                return

        if DRAW_MOTION_MODE == "servo":
            dense = densify_path(poses, DRAW_SERVOP_STEP_MM, DRAW_SERVOP_MAX_STREAM_POINTS)
            state.status = (f"draw: running (servo stream, {len(poses)} waypoints -> "
                             f"{len(dense)} pts @ {DRAW_SERVOP_RATE_HZ:.0f}Hz)…")
            log(f"  [Draw] {state.status}")
            timeout = max(STABLE_TIMEOUT,
                           len(dense) / DRAW_SERVOP_RATE_HZ + DRAW_SERVOP_SETTLE_S + STABLE_TIMEOUT)
            robot.servo_stream(dense, hz=DRAW_SERVOP_RATE_HZ,
                                settle_s=DRAW_SERVOP_SETTLE_S,
                                error_check_interval=DRAW_SERVOP_ERROR_CHECK_S,
                                timeout=timeout, stop_check=state.draw_stop.is_set)
        else:
            state.status = f"draw: running ({len(poses)} waypoints, blended)…"
            log(f"  [Draw] {state.status}")
            timeout = max(STABLE_TIMEOUT, len(poses) * DRAW_PATH_TIMEOUT_PER_POINT_S)
            robot.movl_path(poses, cp=DRAW_CP_RATIO, timeout=timeout,
                             stop_check=state.draw_stop.is_set)

        if state.draw_stop.is_set():
            state.status = "draw aborted"
        else:
            state.status = f"draw done  ({len(poses)} waypoints)"
        log(f"  [Draw] {state.status}")

        # The arm is parked on the last waypoint and not yet told to go home —
        # the only moment achieved pose can be read without extra motion.
        # Goes to last_draw_stats, not test_points: ServoP lags, so this is
        # tracking error and would inflate sheet 05's Max/RMSE. Must precede
        # _notify_draw_done, whose hook re-copies last_draw_stats.
        if not state.draw_stop.is_set():
            try:
                _record_draw_end_check(robot, state, strokes, poses)
            except Exception as e:
                log(f"  [Draw] draw-end check skipped: {e}")

        _notify_draw_done(state, "abort" if state.draw_stop.is_set() else "done",
                          f"waypoints={len(poses)}")
        if not state.draw_stop.is_set():
            _return_to_start(robot, state, start_pose)
    except RobotMoveError as e:
        state.status = f"draw: robot rejected a move — {e} — aborted, check robot log"
        log(f"  [Draw] {state.status}")
        _notify_draw_done(state, "fail", str(e))
    finally:
        state.draw_running = False


def _record_draw_end_check(robot, state, strokes, poses) -> None:
    """Store the arm's achieved pose at the final drawn waypoint as
    state.last_draw_stats["draw_end_check"].

    Read-only — commands no motion. Every failure path ends in "no record",
    never in a plausible-looking wrong number, because a missing measurement
    is visible in the report while a wrong one silently corrupts the thesis
    form. Caller must already have confirmed no Stop is pending, since a
    halted arm never reached poses[-1].
    """
    if not poses:
        return
    uv = _final_stroke_uv(strokes, state.grid_points,
                          state.grid_rows, state.grid_cols)
    if uv is None:
        return
    # No ensure_frame() here on purpose: do_draw() and then
    # servo_stream()/movl_path() already applied the Tool/User frame, and
    # re-issuing Tool()/User() around live motion silently stalled the CR5
    # move queue on 2026-07-28h (robot.py:184-194).
    actual = robot.get_pose()
    if not pose_read_is_plausible(actual, state.grid_points):
        log(f"  [Draw] draw-end check skipped: implausible pose {actual}")
        return
    planned = list(poses[-1][:3])
    actual = [float(c) for c in actual[:3]]
    err = [planned[i] - actual[i] for i in range(3)]
    if not isinstance(getattr(state, "last_draw_stats", None), dict):
        state.last_draw_stats = {}
    state.last_draw_stats["draw_end_check"] = {
        "u": round(uv[0], 4), "v": round(uv[1], 4),
        "planned_xyz": [round(c, 2) for c in planned],
        "actual_xyz": [round(c, 2) for c in actual],
        "error_mm": [round(e, 3) for e in err],
        "deviation_mm": round(math.sqrt(sum(e * e for e in err)), 3),
        "motion_mode": DRAW_MOTION_MODE,
        "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    log(f"  [Draw] draw-end check: dev="
        f"{state.last_draw_stats['draw_end_check']['deviation_mm']}mm")


def _notify_draw_done(state, action: str, detail: str = "") -> None:
    """Report a finished draw run to the event log without importing the router
    (no user context in this thread). The endpoint installs the callback."""
    hook = getattr(state, "on_draw_done", None)
    if hook is None:
        return
    try:
        hook(action, detail)
    except Exception:
        pass
