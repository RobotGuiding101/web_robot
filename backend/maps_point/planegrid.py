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
import math

import cv2
import numpy as np

from .config import (
    DRAW_SIMPLIFY_EPS, DRAW_MAX_POINTS, DRAW_MAX_RMSE_MM, DRAW_MIN_GRID_SPAN_MM,
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
    entirely for programmatically-generated shapes (line/rect/circle):
    Douglas-Peucker would happily collapse a circle's ~36 evenly-spaced
    points down to a handful of vertices (each point's deviation from its
    neighbors' chord is tiny for a smooth curve, exactly what eps is
    designed to discard), turning a circle back into a visibly-faceted
    polygon — the same "not detailed enough" complaint that motivated
    ServoP streaming in the first place, reintroduced through a different
    path if this function were applied unconditionally."""
    if len(points_uv) <= 2:
        return list(points_uv)
    arr = np.array(points_uv, dtype=np.float32).reshape(-1, 1, 2)
    simplified = cv2.approxPolyDP(arr, eps, closed=False).reshape(-1, 2).tolist()
    return _cap_points(simplified, DRAW_MAX_POINTS)


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
    — {"tool": "pen"|"line"|"rect"|"circle", "points": [(u,v), ...]} —
    mapped through the taught grid to Cartesian [X,Y,Z,Rx,Ry,Rz]
    waypoints. Only "pen" strokes go through simplify_stroke() (see its
    own docstring for why line/rect/circle must NOT be simplified — they
    were already generated as the exact vertices intended, not noisy
    mousemove samples)."""
    points_uv = stroke.get("points") or []
    path = simplify_stroke(points_uv) if stroke.get("tool") == "pen" else _cap_points(points_uv, DRAW_MAX_POINTS)
    return [grid_pose(u, v, grid_points, rows, cols) for u, v in path]


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

    Only strokes AFTER the first get a lift-in transition — the very
    first stroke's starting move is untouched (robot just moves straight
    there from wherever it currently is), matching this feature's
    pre-existing single-stroke behavior."""
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


def do_draw(robot: Robot, state, strokes: list) -> None:
    """Background-thread action (see main.py's /api/draw) — `strokes` is a
    list of {"tool": "pen"|"line"|"rect"|"circle", "points": [(u,v), ...]}
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
    except RobotMoveError as e:
        state.status = f"draw: robot rejected a move — {e} — aborted, check robot log"
        log(f"  [Draw] {state.status}")
    finally:
        state.draw_running = False
