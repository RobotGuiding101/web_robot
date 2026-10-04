"""maps_point/align.py — the alignment algorithm.

Axis mapping, depth-only plane tracking, and the three-phase (probe-sign,
converge tilt, correct roll) control loop that rotates the tool to match a
marked plane. Orchestrates Robot + Camera but contains no Flask/HTTP code
and no low-level hardware protocol — this is the "calculation/decision"
layer, ported from pick_45degree.py's do_align_normal().

Object tracking is depth-only (Camera.sample_plane_region_grow(), see its
docstring) as of 2026-07-28 — no color image, no per-point optical flow.
Earlier this tracked 4 marked pixel corners with LK optical flow, which
could (and did, 2026-07-27i) drift a corner onto the background with
nothing to geometrically check it against.
"""
import threading
from time import sleep, time as _time

from .config import (
    CAM_X_SIGN, CAM_Y_SIGN, HOME_Z,
    WELD_TOOL_INDEX, ALIGN_GAIN_DEG, ALIGN_MAX_STEP_DEG, ALIGN_TOL_DEG,
    ALIGN_MAX_STEPS, ALIGN_PROBE_DEG, ALIGN_FINE_TILT_DEG, ALIGN_FINE_SCALE,
    ALIGN_APPROACH_Z_OFFSET, ALIGN_DIVERGE_MARGIN_DEG, ALIGN_DIVERGE_STREAK,
    ALIGN_RECENTER_MARGIN, ALIGN_MAX_RECENTER_ATTEMPTS, ALIGN_MAX_REPROBES, ALIGN_MAX_RMSE_MM,
    ALIGN_DEPTH_TOL_MM, ALIGN_RZ_TOL_DEG, ALIGN_RZ_GAIN, ALIGN_RZ_MAX_STEP_DEG,
    ALIGN_RZ_MAX_ITERS,
)
from .robot import Robot, RobotMoveError
from .camera import Camera
from .motion import goto_pixel
from .recording import AlignRecorder

# axis -> (RelMovLTool kwarg, index into _region_grow_measure()'s return
# tuple that axis is meant to drive to zero). rx corrects n_tool_y (index
# 1), ry corrects n_tool_x (index 0), rz corrects roll_deg (index 5).
_AXIS_KWARG         = {"rx": "drx", "ry": "dry", "rz": "drz"}
_AXIS_COMPONENT_IDX = {"rx": 1, "ry": 0, "rz": 5}


def _region_grow_measure(cam: Camera, state: "AppState"):
    """Depth-only measurement: grow the object's region from state's
    current seed pixel (Camera.sample_plane_region_grow(), no color image
    involved), update state.points (now a rotated-bounding-box quad
    approximating the grown region — kept for drawing/recenter-guard/goto-
    centroid compatibility, NOT literal clicked corners once tracking has
    taken over) and state.tracking_ok, and return the axis-mapped
    (n_tool_x, n_tool_y, tilt, rmse_mm, depth_range_mm, roll_deg) — or None
    if the region couldn't be grown (object likely left frame, or the seed
    no longer sits on any depth-consistent surface). Every call re-derives
    the region fresh from depth; nothing is incrementally tracked frame to
    frame, so there's no accumulation for drift to hide in."""
    if getattr(state, "_seed", None) is None:
        if not state.points:
            state.tracking_ok = False
            return None
        cx = sum(p[0] for p in state.points) / len(state.points)
        cy = sum(p[1] for p in state.points) / len(state.points)
        state._seed = (int(cx), int(cy))
        state._prev_bbox = None

    result = cam.sample_plane_region_grow(state._seed[0], state._seed[1], ALIGN_DEPTH_TOL_MM,
                                           state._prev_bbox, expected_tilt_deg=state.last_tilt)
    if result is None and state._prev_bbox is not None:
        # The windowed search (sized from the last known region) came up
        # empty. On hardware 2026-07-28e this happened repeatedly at the
        # same point in a rotation trajectory — the object may simply
        # have moved further between measurements than that window
        # allowed for (e.g. a bigger single "coarse"-phase step). Retry
        # once with the full seed-centered window (prev_bbox=None) before
        # giving up — cheap (one extra depth-buffer fit), and turns a
        # "moved further than expected" case into a recoverable one
        # instead of a hard failure.
        result = cam.sample_plane_region_grow(state._seed[0], state._seed[1], ALIGN_DEPTH_TOL_MM,
                                               None, expected_tilt_deg=state.last_tilt)
    if result is None:
        state.tracking_ok = False
        return None

    nx, ny, nz, tilt, rmse_mm, depth_range_mm, roll_deg, quad_px = result
    state.points = quad_px
    state.tracking_ok = True
    cx = sum(p[0] for p in quad_px) / 4
    cy = sum(p[1] for p in quad_px) / 4
    state._seed = (int(cx), int(cy))
    xs = [p[0] for p in quad_px]; ys = [p[1] for p in quad_px]
    state._prev_bbox = (min(xs), min(ys), max(xs), max(ys))

    n_tool_x = -ny * CAM_X_SIGN
    n_tool_y =  nx * CAM_Y_SIGN
    return n_tool_x, n_tool_y, tilt, rmse_mm, depth_range_mm, roll_deg


def _wait_tracking_ok(state: "AppState", timeout: float = 1.2) -> bool:
    """Poll state.tracking_ok for up to `timeout` seconds before giving up.
    The continuous background tracker re-derives the region fresh from
    depth every ~30ms, so a single momentary miss (one noisy depth cycle,
    a transient buffer race, or the widened-window retry in
    _region_grow_measure needing an extra cycle) can flip tracking_ok
    False briefly and recover on its own. On hardware 2026-07-28d a run
    aborted with "lost tracking" between two frames that, side by side,
    showed the object hadn't moved or changed at all — treating a brief
    miss as a hard failure was too eager. Widened from 0.5s to 1.2s after
    2026-07-28e recurred at the same trajectory point across multiple
    runs even with the original grace period, suggesting recovery needed
    more than one or two cycles. Give the tracker a real window to
    self-correct before believing it's genuinely lost."""
    deadline = _time() + timeout
    while _time() < deadline:
        if state.tracking_ok:
            return True
        sleep(0.03)
    return state.tracking_ok


class AppState:
    """Web-app analogue of pick_45degree.py's PickSession, trimmed to what
    step 1 (align only) needs."""

    def __init__(self):
        self.points: list = []               # up to 4 (x,y) pixel points
        # bumped by main.py's /api/point and /api/reset_points whenever the
        # user provides a NEW ground-truth click — tells the continuous
        # background tracker (see start_tracking_thread) to reset its
        # reference frame instead of trying to track from stale points
        self.points_gen = 0
        # True once the continuous tracker (start_tracking_thread) has a
        # good lock on the marked points — do_align() reads this directly
        # instead of running its own separate tracker (see module docstring
        # note below): there is exactly ONE tracker for this app, so what's
        # drawn on screen and what align measures are always the same thing.
        self.tracking_ok = False
        # depth-region-growing state (_region_grow_measure) — the seed
        # pixel and bounding box the NEXT measurement grows from. Reset to
        # None (fresh seed from state.points' centroid) whenever points_gen
        # changes, i.e. a brand new mark.
        self._seed = None
        self._prev_bbox = None
        self.align_running = False
        self.align_stop    = threading.Event()
        self.initial_rmse     = None   # rmse ก่อนเริ่มแก้แนวในรอบล่าสุด
        self.final_tilt       = None   # tilt ตอน align done — ไม่ถูก overwrite
        self.final_rmse       = None   # rmse ตอน align done — ไม่ถูก overwrite
        self.last_tilt        = None
        self.last_rmse        = None
        self.last_depth_range = None
        self.last_center_depth = None
        self.last_roll_deg    = None   # phase-3 Rz correction target, see do_align
        self.heatmap_mode = False   # main.py's MJPEG generator reads this
        self.status = "idle"

        # ── draw: N×M grid plane calibration + freehand path replay ────────
        # (planegrid.py) — a separate feature from align above: no camera
        # tracking involved, grid_points are whatever pose the user jogged
        # to and pressed "mark" at. 2×2 (default) is the simple 4-corner
        # case; row 0 = top = v=0, col 0 = left = u=0.
        self.grid_rows = 2
        self.grid_cols = 2
        self.grid_points = [[None, None], [None, None]]  # [row][col] -> [X,Y,Z,Rx,Ry,Rz] or None
        self.draw_running = False
        self.draw_stop = threading.Event()


def _probe_align_sign(robot: Robot, cam: Camera, state: "AppState", axis: str,
                       rec: AlignRecorder):
    """Nudge a small ALIGN_PROBE_DEG test rotation on one axis ('rx', 'ry',
    or 'rz'), check whether the component that axis corrects (n_tool_y for
    rx, n_tool_x for ry, roll_deg for rz — see _AXIS_COMPONENT_IDX) actually
    shrank, then undo the nudge — net rotation from this function is zero.
    Returns +1 if positive helps, -1 if it needs flipping, or None if
    tracking was lost (caller must abort — no guessing). Learns the sign
    empirically instead of guessing the CR5 controller's Euler/RPY
    composition order (not confirmed in this codebase).

    Reads state.points/state.tracking_ok rather than running its own
    tracker — the continuous background tracker (_continuous_tracking_loop)
    keeps tracking THROUGH the rel_movl_tool() calls below too (it runs in
    its own thread the whole time this function blocks), so by the time
    each move returns, state.points already reflects everything the
    tracker saw during the motion — not just a single before/after
    snapshot bridging a multi-second gap."""
    if not _wait_tracking_ok(state):
        return None
    before = _region_grow_measure(cam, state)
    rec.snap(robot, cam, state, f"probe_{axis}_before",
             {"axis": axis, "n_tool_x": before[0] if before else None,
              "n_tool_y": before[1] if before else None,
              "roll_deg": before[5] if before else None})

    kwarg = _AXIS_KWARG[axis]
    robot.rel_movl_tool(0, 0, 0, tool=WELD_TOOL_INDEX, **{kwarg: ALIGN_PROBE_DEG})

    if not _wait_tracking_ok(state):
        robot.rel_movl_tool(0, 0, 0, tool=WELD_TOOL_INDEX, **{kwarg: -ALIGN_PROBE_DEG})
        rec.snap(robot, cam, state, f"probe_{axis}_lost_tracking")
        return None
    after = _region_grow_measure(cam, state)
    rec.snap(robot, cam, state, f"probe_{axis}_after",
             {"axis": axis, "n_tool_x": after[0] if after else None,
              "n_tool_y": after[1] if after else None,
              "roll_deg": after[5] if after else None})

    robot.rel_movl_tool(0, 0, 0, tool=WELD_TOOL_INDEX, **{kwarg: -ALIGN_PROBE_DEG})

    if before is None or after is None:
        return 1
    idx = _AXIS_COMPONENT_IDX[axis]
    component_before = before[idx]
    component_after  = after[idx]
    # Signed-difference test — did the positive probe nudge increase or
    # decrease the component? This is the TRUE local restoring sign
    # (d(component)/d(axis)'s own sign at this orientation), correct
    # regardless of which side of zero the component sits on — unlike the
    # old magnitude-shrink test ("did |component| shrink"), which silently
    # gives the WRONG answer whenever component_before is negative (see
    # the 2026-08-05 gotcha in CLAUDE.md — reproduced identically on 3
    # separate hardware runs: rx got re-probed 3 times, the magnitude test
    # confirmed the same sign every time, yet tilt climbed every step
    # regardless, 11.2°→32.6°, until the divergence guard aborted).
    #
    # rx and rz share the SAME convention: phase 3 applies
    # `d = sign * component * gain` for both (`sign_rx * n_tool_y * gain`,
    # `sign_rz * roll_deg * gain` — see the convergence loop / _converge_rz),
    # so a positive nudge that INCREASED the component means the
    # correction must go the OTHER way: sign = -1 if increased else +1.
    #
    # ry is the ODD ONE OUT — phase 3 applies an extra negation for it,
    # `d_ry = sign_ry * -n_tool_x * gain` (see the convergence loop), so
    # ry's correct sign is the OPPOSITE of rx/rz's rule. Missing this
    # exact asymmetry is what broke the first attempt at this fix
    # (2026-08-05, reverted same day): applying rx's rule to ry as well
    # made ry diverge immediately from step 1 (16.5°→39.1° in 6 steps) —
    # cross-checked against that failed run's own recorded probe values
    # before re-applying this, see CLAUDE.md.
    if axis == "ry":
        sign = 1 if component_after > component_before else -1
    else:
        sign = -1 if component_after > component_before else 1
    rec.log(f"  [Align] probe {axis}: component {component_before:+.3f} → "
            f"{component_after:+.3f}  sign={sign:+d}")
    return sign


def _recenter_xy(robot: Robot, cam: Camera, state: "AppState", rec: AlignRecorder, label: str,
                  to_margin_only: bool = False):
    """Move XY to correct a tracked point drifting toward a frame edge —
    same Z/Rx/Ry/Rz, doesn't touch any rotation already made.

    to_margin_only=False (default) aims for TRUE dead-center — the
    object's centroid becomes the image center. Used by the one-time
    final tidy-up (_finish_centered) once align is done.

    to_margin_only=True aims for the SMALLEST correction that brings every
    out-of-margin point back to just inside ALIGN_RECENTER_MARGIN, not all
    the way to dead-center. Used by the reactive guard mid-convergence
    (phase 3), added 2026-07-28m at the user's request: aiming for dead-
    center on EVERY reactive correction (this guard can fire many times
    per run) repeatedly stretched the arm further than the actual problem
    (a point about to leave frame) required, hitting the same IK/reach
    limit (error 17) over and over on hardware 2026-07-28l. A margin-only
    correction solves the actual problem with a much smaller move.

    A long/narrow object can have points violating the margin on BOTH
    sides of the same axis at once (one end near the left edge, the other
    near the right) — no single XY shift can satisfy both if the object's
    own footprint is wider than cam.w - 2*margin. Fixed 2026-08-05: the
    needed shift from each side is now tracked separately (need_pos_x/
    need_neg_x etc below) instead of folded into one running max()/min()
    accumulator, which could cancel out to a shift that fixed NEITHER
    side (or made one worse) and left the reactive guard re-triggering
    forever. When both sides are violated, this splits the difference
    (best-effort centering) instead.
    """
    cx_px = sum(p[0] for p in state.points) / len(state.points)
    cy_px = sum(p[1] for p in state.points) / len(state.points)
    img_cx, img_cy = cam.w / 2, cam.h / 2

    if to_margin_only:
        mx, my = cam.w * ALIGN_RECENTER_MARGIN, cam.h * ALIGN_RECENTER_MARGIN
        need_pos_x = need_neg_x = 0.0   # shift needed by left-side / right-side violators
        need_pos_y = need_neg_y = 0.0   # shift needed by top-side / bottom-side violators
        for px, py in state.points:
            if px < mx:
                need_pos_x = max(need_pos_x, mx - px)
            elif px > cam.w - mx:
                need_neg_x = min(need_neg_x, (cam.w - mx) - px)
            if py < my:
                need_pos_y = max(need_pos_y, my - py)
            elif py > cam.h - my:
                need_neg_y = min(need_neg_y, (cam.h - my) - py)
        shift_x = (need_pos_x + need_neg_x) / 2 if (need_pos_x and need_neg_x) else (need_pos_x or need_neg_x)
        shift_y = (need_pos_y + need_neg_y) / 2 if (need_pos_y and need_neg_y) else (need_pos_y or need_neg_y)
        target_px_full = img_cx - shift_x
        target_py_full = img_cy - shift_y
    else:
        target_px_full = cx_px
        target_py_full = cy_px

    # ensure_frame() before this read — same reasoning as goto_pixel's own
    # internal read (see Robot.ensure_frame()'s docstring): a preceding
    # rel_movl_tool(tool=N) rotation can leave the dashboard on a
    # different Tool selection, which would make this Z reading wrong too.
    robot.ensure_frame()
    _, _, curZ, _, _, _ = robot.get_pose()

    # Even the (now smaller, margin-only) target isn't always reachable at
    # a steep tilt — on hardware 2026-07-28j this hit a real IK/no-
    # solution error (code 17), a genuine kinematic limit at that
    # position/orientation, not a bug. Try progressively smaller fractions
    # of the way to the target before giving up entirely — on hardware
    # 2026-07-28l even the half-step fraction sometimes still isn't
    # reachable, so this keeps going down to a quarter-step.
    #
    # MUST clear_error() before EACH retry — on hardware 2026-07-28k a
    # retry failed with the identical error immediately, because entering
    # RobotMode=9 (ERROR) LATCHES: the controller rejects every
    # subsequent motion command outright, regardless of size, until
    # explicitly cleared. Without this, no retry could ever have
    # succeeded no matter how small the step was.
    for i, frac in enumerate((1.0, 0.5, 0.25)):
        px = target_px_full + (1.0 - frac) * (img_cx - target_px_full)
        py = target_py_full + (1.0 - frac) * (img_cy - target_py_full)
        try:
            goto_pixel(robot, cam, px, py, z=curZ)
            break
        except RobotMoveError as e:
            if frac <= 0.25:
                # Out of smaller steps to try — let it propagate to
                # do_align's own RobotMoveError handler rather than
                # shrinking/clearing forever chasing an orientation that
                # may just not be reachable anywhere near here.
                raise
            rec.log(f"  [Align] re-center at {frac:.2f}x rejected ({e}) — clearing "
                    f"error and retrying at {(0.5, 0.25)[i]:.2f}x")
            robot.clear_error()
            sleep(0.5)
    rec.snap(robot, cam, state, label)


def _finish_centered(robot: Robot, cam: Camera, state: "AppState", rec: AlignRecorder,
                      tilt: float, roll: float):
    """Called once tilt AND roll have both converged — re-centers XY
    (_recenter_xy) then re-measures so the final reported numbers reflect
    the recentered position, instead of leaving the object off to one side
    of frame just because no point ever wandered close enough to an edge
    to trigger the reactive re-center guard mid-run. Added 2026-07-28c."""
    state.status = "align: centering object in frame…"
    rec.log(f"  [Align] {state.status}")
    _recenter_xy(robot, cam, state, rec, "final_recentered")
    result = _region_grow_measure(cam, state)
    if result is not None:
        _, _, tilt, rmse, _, roll = result
        state.last_tilt, state.last_roll_deg = tilt, roll
        state.final_rmse = rmse   # freeze ค่า rmse ตอน align done
    state.status = f"align done  tilt={tilt:.1f}°  roll={roll:.1f}°"
    state.final_tilt = tilt   # freeze ค่า tilt ตอน align done ไม่ถูก overwrite
    rec.log(f"  [Align] {state.status}")


def _converge_rz(robot: Robot, cam: Camera, state: "AppState", rec: AlignRecorder):
    """Phase 3 of do_align — runs only after phase 2 has brought tilt
    within ALIGN_TOL_DEG (or phase 1 found it already there). Corrects
    roll: rotation around the camera's own viewing axis, which tilt_deg is
    mathematically blind to — the tool can read tilt=0 and still be rolled
    arbitrarily relative to the object in-frame. Same probe-then-converge
    pattern as rx/ry (see _probe_align_sign), just a single DOF against the
    marked region's own apparent rotation in-image (roll_deg from
    Camera.sample_plane_region_grow(), normalized into (-45,45]). Added
    2026-07-28 at the user's request ("ถ้ากล้องมันเอียงก็หมุนแกน Rz ให้
    ได้ระนาบ"). Any RobotMoveError from the rel_movl_tool() calls below
    propagates up to do_align's own except clause — this function doesn't
    need its own."""
    state.status = f"align: correcting roll (rz, probe ±{ALIGN_PROBE_DEG:.1f}°)…"
    rec.log(f"  [Align] {state.status}")
    sign_rz = _probe_align_sign(robot, cam, state, "rz", rec)
    if state.align_stop.is_set():
        state.status = "align aborted during rz correction"
        rec.log(f"  [Align] {state.status}")
        return
    if sign_rz is None:
        state.status = "align: lost tracking during rz probe — re-mark and retry"
        rec.log(f"  [Align] {state.status}")
        return
    rec.log(f"  [Align] rz direction confirmed  sign_rz={sign_rz:+d}")

    prev_abs_roll = None
    worsen_streak = 0
    reprobe_count = 0
    for step in range(ALIGN_RZ_MAX_ITERS):
        if state.align_stop.is_set():
            state.status = f"align aborted during rz correction at step {step+1}"
            rec.log(f"  [Align] {state.status}")
            return
        if not _wait_tracking_ok(state):
            state.status = "align: lost tracking during rz correction — re-mark and retry"
            rec.log(f"  [Align] {state.status}")
            return

        result = _region_grow_measure(cam, state)
        if result is None:
            state.status = "align: bad plane fit during rz correction, aborted"
            rec.log(f"  [Align] {state.status}")
            return
        _, _, tilt_now, rmse_now, depth_range_now, roll_deg = result
        state.last_tilt, state.last_rmse, state.last_depth_range = tilt_now, rmse_now, depth_range_now
        state.last_roll_deg = roll_deg
        state.status = (f"align: rz step {step+1}/{ALIGN_RZ_MAX_ITERS}  "
                         f"roll={roll_deg:.1f}°  tilt={tilt_now:.1f}°")
        rec.log(f"  [Align] {state.status}")

        if rmse_now > ALIGN_MAX_RMSE_MM:
            state.status = (f"align: plane fit degraded during rz correction "
                             f"(rmse={rmse_now:.2f}mm) — re-mark and retry")
            rec.log(f"  [Align] {state.status}")
            return

        rec.snap(robot, cam, state, f"rz_step{step+1:03d}", {"roll_deg": roll_deg})

        if abs(roll_deg) <= ALIGN_RZ_TOL_DEG:
            _finish_centered(robot, cam, state, rec, tilt_now, roll_deg)
            return

        # divergence guard — this phase had NO safety net at all until
        # hardware 2026-07-28b ran all ALIGN_RZ_MAX_ITERS steps pushing
        # roll further from zero every time (a sign bug, since fixed in
        # _probe_align_sign — see its comment on why a raw linear angle
        # like roll_deg needs a different sign rule than n_tool_x/
        # n_tool_y) without ever stopping early. Same pattern as phase 3's
        # tilt divergence guard, just watching |roll_deg| instead of tilt.
        if prev_abs_roll is not None and abs(roll_deg) > prev_abs_roll + ALIGN_DIVERGE_MARGIN_DEG:
            worsen_streak += 1
        else:
            worsen_streak = 0
        prev_abs_roll = abs(roll_deg)

        # re-probe-on-worsen — same pattern as phase 3's tilt convergence
        # (see its comment): a sign learned from ONE probe measurement of
        # roll_deg isn't always reliable (on hardware 2026-07-28f, the
        # probe measured a slope implying one sign, but the very next
        # convergence step behaved as if the true slope were the OPPOSITE
        # — roll_deg from cv2.minAreaRect can be a more fragile/noisy
        # signal than the tilt-phase's n_tool_x/n_tool_y, especially at
        # small angles). Re-probe once the first time a step makes roll
        # worse, bounded by ALIGN_MAX_REPROBES, before falling through to
        # the hard abort below.
        if worsen_streak == 1 and reprobe_count < ALIGN_MAX_REPROBES:
            state.status = "align: roll made worse — re-probing rz sign"
            rec.log(f"  [Align] {state.status}")
            new_sign = _probe_align_sign(robot, cam, state, "rz", rec)
            if state.align_stop.is_set():
                state.status = "align aborted during rz correction"
                rec.log(f"  [Align] {state.status}")
                return
            if new_sign is None:
                state.status = "align: lost tracking during rz re-probe — re-mark and retry"
                rec.log(f"  [Align] {state.status}")
                return
            if new_sign != sign_rz:
                rec.log(f"  [Align] sign_rz flipped {sign_rz:+d} → {new_sign:+d}")
            sign_rz = new_sign
            reprobe_count += 1
            worsen_streak = 0

        if worsen_streak >= ALIGN_DIVERGE_STREAK:
            state.status = (f"align: roll worsened {worsen_streak} steps in a row "
                             f"(now {roll_deg:.1f}°) during rz correction — aborted, "
                             f"check recording ({rec.dir.name})")
            rec.log(f"  [Align] {state.status}")
            return

        d_rz = max(-ALIGN_RZ_MAX_STEP_DEG,
                   min(ALIGN_RZ_MAX_STEP_DEG, sign_rz * roll_deg * ALIGN_RZ_GAIN))
        robot.rel_movl_tool(0, 0, 0, tool=WELD_TOOL_INDEX, drz=d_rz)

    state.status = f"align: rz correction stopped — {ALIGN_RZ_MAX_ITERS} steps without converging"
    rec.log(f"  [Align] {state.status}")


def do_align(robot: Robot, cam: Camera, state: AppState):
    """Runs in a background thread (see main.py's /api/align). Three phases:
      0. Move XY to the centroid of the 4 marked points, at
         Z=HOME_Z+ALIGN_APPROACH_Z_OFFSET — a rough approach position (no
         CAM_TCP_OFFSET calibration assumed) so the align rotation starts
         roughly above the object instead of wherever the robot happened
         to be left.
      1. _probe_align_sign() on rx then ry — learn each axis's correct
         rotation direction empirically instead of guessing.
      2. Converge with small proportional steps, pivoting about Tool 1
         (probe tip stays put) — switches to a smaller ALIGN_FINE_SCALE
         step once tilt drops under ALIGN_FINE_TILT_DEG, so the final
         approach is smooth instead of overshooting at full step size.
    No touching down — rotation only, per step-1 scope.

    Does NOT run its own point tracker — reads state.points/tracking_ok,
    kept fresh by the continuous background tracker (_continuous_tracking_
    loop, started once at app startup) which tracks continuously the whole
    time, including WHILE the robot is mid-rotation inside rel_movl_tool()
    (that call blocks in THIS thread; the tracker keeps running in ITS
    own thread throughout). Before 2026-07-25d this function ran a SEPARATE
    tracker that only sampled once before/after each discrete move —
    meaning zero tracking happened during the multi-second rotation itself,
    a much bigger single jump for the optical flow to bridge, and the video
    overlay would visibly freeze between samples. One tracker, always on,
    fixes both.

    Every run is recorded to disk (recording.AlignRecorder): a JPEG +
    JSON line per step, so a run that behaves strangely can be reviewed
    afterward instead of just watching it happen live and losing the
    evidence (2026-07-25e).
    """
    if state.align_running:
        return
    if not robot.connected or not cam._running:
        state.status = "align: robot/camera not ready"
        return
    if len(state.points) < 4:
        state.status = "align: need 4 points"
        return
    if not state.tracking_ok:
        state.status = "align: points not locked on yet — wait a moment or re-mark"
        return

    state.align_running = True
    state.align_stop.clear()
    state.initial_rmse = None
    state.final_rmse = None
    rec = AlignRecorder()
    try:
        # ── phase 0: move to the marked area's center, at HOME_Z + offset ──
        # extra lift vs the standalone Goto (which uses HOME_Z exactly) —
        # HOME_Z alone put the camera too close to see the surface (D455
        # min depth range) during testing 2026-07-25c.
        cx_px = sum(p[0] for p in state.points) / len(state.points)
        cy_px = sum(p[1] for p in state.points) / len(state.points)
        approach_z = (HOME_Z + ALIGN_APPROACH_Z_OFFSET) if HOME_Z else None
        state.status = "align: moving to center of marked points…"
        rec.snap(robot, cam, state, "phase0_before_move")
        rec.log(f"  [Align] {state.status}")
        result = goto_pixel(robot, cam, cx_px, cy_px, z=approach_z)
        if result is None:
            state.status = "align: no valid depth at marked center — no guessing"
            rec.log(f"  [Align] {state.status}")
            return
        tX, tY, tZ = result
        rec.log(f"  [Align] moved to  ({tX:.1f}, {tY:.1f}, {tZ:.1f})")
        rec.snap(robot, cam, state, "phase0_after_move", {"target": [tX, tY, tZ]})
        if state.align_stop.is_set():
            state.status = "align aborted"; return

        # ── phase 1: learn each axis's rotation sign ───────────────────────
        if not _wait_tracking_ok(state):
            state.status = "align: lost tracking of marked points — re-mark and retry"
            rec.log(f"  [Align] {state.status}")
            return
        start = _region_grow_measure(cam, state)
        if start is None:
            state.status = "align: no valid plane fit — no guessing"
            rec.log(f"  [Align] {state.status}")
            return
        state.initial_rmse = start[3]
        state.last_tilt, state.last_rmse, state.last_depth_range = start[2], start[3], start[4]
        rec.snap(robot, cam, state, "phase1_initial_measurement")
        if start[3] > ALIGN_MAX_RMSE_MM:
            state.status = (f"align: initial plane fit is poor (rmse={start[3]:.2f}mm > "
                             f"{ALIGN_MAX_RMSE_MM:.1f}mm) — check the 4 marked corners, re-mark and retry")
            rec.log(f"  [Align] {state.status}")
            return
        if start[2] <= ALIGN_TOL_DEG:
            state.status = f"align done  tilt={start[2]:.1f}°"
            rec.log(f"  [Align] {state.status}")
            _converge_rz(robot, cam, state, rec)
            return

        state.status = f"align: calibrating rotation directions (probe ±{ALIGN_PROBE_DEG:.1f}°)…"
        rec.log(f"  [Align] {state.status}")
        sign_rx = _probe_align_sign(robot, cam, state, "rx", rec)
        if state.align_stop.is_set():
            state.status = "align aborted"; return
        if sign_rx is None:
            state.status = "align: lost tracking of marked points — re-mark and retry"
            rec.log(f"  [Align] {state.status}")
            return
        sign_ry = _probe_align_sign(robot, cam, state, "ry", rec)
        if state.align_stop.is_set():
            state.status = "align aborted"; return
        if sign_ry is None:
            state.status = "align: lost tracking of marked points — re-mark and retry"
            rec.log(f"  [Align] {state.status}")
            return
        rec.log(f"  [Align] directions confirmed  sign_rx={sign_rx:+d}  sign_ry={sign_ry:+d}")
        signs = {"rx": sign_rx, "ry": sign_ry}

        # ── phase 2: converge, ONE axis at a time, LARGEST ERROR FIRST ─────
        # Move rx and ry as separate steps instead of one combined
        # RelMovLTool(drx=.., dry=..) call — avoids cross-axis coupling and
        # lets each axis's actual effect be checked before compounding with
        # the other. state.points is kept fresh by the continuous tracker
        # throughout — see this function's docstring.
        #
        # Which axis gets picked each step is no longer a fixed rx/ry/rx/ry
        # alternation (changed 2026-07-27h) — every recording so far starts
        # with n_tool_y (rx's target component) already ~0.000-0.001, i.e.
        # basically zero real error, while n_tool_x (ry's target) starts
        # around 0.36, a large and unambiguous real error. Alternating
        # anyway meant rx was rotated every OTHER step from step 1 based on
        # a sign learned from noise (see the re-probe-on-worsen gotcha),
        # perturbing n_tool_y away from its already-near-zero value for no
        # real reason and forcing ry to correct for damage rx didn't need
        # to cause — a likely contributor to the compounding drift that
        # eventually ran the tool far enough to hit an IK/out-of-working-
        # area rejection on 2026-07-27h. Picking whichever component is
        # CURRENTLY larger each step is a standard coordinate-descent move:
        # it naturally spends most early steps on the axis that actually
        # has a real error, and only starts alternating once the two
        # components are genuinely comparable in size — self-adapting
        # instead of hardcoding "always ry first".
        max_steps      = ALIGN_MAX_STEPS
        prev_tilt      = start[2]
        worsen_streak  = 0
        last_axis      = None   # axis rotated in the previous iteration
        reprobe_count  = 0
        recenter_streak = 0     # consecutive re-center attempts that still left a point near an edge
        converged      = False   # set True only by the tilt<=ALIGN_TOL_DEG break below
        for step in range(max_steps):
            if state.align_stop.is_set():
                state.status = f"align aborted at step {step+1}"
                rec.log(f"  [Align] {state.status}")
                break

            if not _wait_tracking_ok(state):
                state.status = "align: lost tracking of marked points — re-mark and retry"
                rec.snap(robot, cam, state, f"step{step+1:03d}_lost_tracking")
                rec.log(f"  [Align] {state.status}")
                break

            result = _region_grow_measure(cam, state)
            if result is None:
                state.status = "align: bad plane fit, aborted"
                rec.log(f"  [Align] {state.status}")
                break

            n_tool_x, n_tool_y, tilt, rmse_mm, depth_range_mm, roll_deg = result
            state.last_roll_deg = roll_deg
            state.last_tilt, state.last_rmse, state.last_depth_range = tilt, rmse_mm, depth_range_mm
            fine = tilt <= ALIGN_FINE_TILT_DEG
            # rx corrects n_tool_y, ry corrects n_tool_x (see
            # _probe_align_sign) — pick whichever has the larger CURRENT
            # error each step instead of blindly alternating (see the note
            # above this loop).
            axis = "rx" if abs(n_tool_y) >= abs(n_tool_x) else "ry"
            state.status = (f"align: step {step+1}/{max_steps} ({axis})  tilt={tilt:.1f}°  "
                             f"rmse={rmse_mm:.2f}mm  depth_range={depth_range_mm:.1f}mm  "
                             f"{'fine' if fine else 'coarse'}")
            rec.log(f"  [Align] {state.status}")

            # ── plane-fit-quality guard ──────────────────────────────────────
            # Historical note: this guard was added 2026-07-27i when object
            # tracking was still 4 independently-tracked color-image points
            # (optical flow, no shape constraint) — one drifted onto the
            # background while the other 3 still looked fine and
            # tracking_ok stayed True, rmse_mm jumped from ~0.65mm to
            # 4.38mm, and the run kept "converging" on a plane that wasn't
            # the object's anymore. Tracking is depth-only region-growing
            # now (2026-07-28), which is far less prone to that exact
            # failure (a background pixel can't satisfy the current plane's
            # depth prediction) — kept as a safety net regardless, e.g. for
            # a genuinely non-flat surface or a region-grow that leaked
            # onto an adjacent surface at a similar predicted depth.
            if rmse_mm > ALIGN_MAX_RMSE_MM:
                state.status = (f"align: plane fit degraded (rmse={rmse_mm:.2f}mm > "
                                 f"{ALIGN_MAX_RMSE_MM:.1f}mm) — a marked point likely "
                                 f"drifted off the object, re-mark and retry")
                rec.log(f"  [Align] {state.status}")
                break

            # ── re-center guard ─────────────────────────────────────────────
            # Rotation-only convergence doesn't correct XY — nothing stops
            # the object drifting toward a frame edge as tilt accumulates.
            # On hardware 2026-07-27, ry did most of the real correcting and
            # steadily pushed the marked box toward the bottom edge over 11
            # steps — tilt WAS genuinely improving (21°→11.7°) — until a
            # point finally went out of frame and tracking failed. If any
            # tracked point is within ALIGN_RECENTER_MARGIN of an edge, nudge
            # XY back toward center (same Z/Rx/Ry/Rz — doesn't touch the
            # rotation already made) instead of rotating until it falls off.
            mx, my = cam.w * ALIGN_RECENTER_MARGIN, cam.h * ALIGN_RECENTER_MARGIN
            near_edge = any(
                px < mx or px > cam.w - mx or py < my or py > cam.h - my
                for px, py in state.points
            )
            if near_edge:
                # A long/narrow object's own footprint can exceed
                # cam.w/h - 2*ALIGN_RECENTER_MARGIN — no XY shift clears
                # the margin on both ends at once, so this guard could
                # otherwise fire, "fix", still see near_edge, and re-fire
                # forever without ever reaching a rotation step (hardware
                # 2026-08-05). After ALIGN_MAX_RECENTER_ATTEMPTS
                # consecutive attempts, stop trying and rotate anyway.
                recenter_streak += 1
                if recenter_streak > ALIGN_MAX_RECENTER_ATTEMPTS:
                    rec.log(f"  [Align] object still near a frame edge after "
                             f"{recenter_streak - 1} recenter attempts (likely too "
                             f"large for the margin) — continuing to rotate anyway")
                else:
                    state.status = "align: re-centering (points near frame edge)"
                    rec.log(f"  [Align] {state.status}")
                    _recenter_xy(robot, cam, state, rec, f"step{step+1:03d}_recentered",
                                 to_margin_only=True)
                    continue
            else:
                recenter_streak = 0

            # ── divergence guard ────────────────────────────────────────────
            # Previously the loop just trusted sign_rx/sign_ry forever once
            # learned — on hardware 2026-07-25e it kept moving the SAME
            # direction for many steps even as tilt visibly got worse each
            # time, ending in "lost tracking" instead of stopping. Now:
            # count consecutive steps where tilt got meaningfully worse and
            # bail before it runs away.
            if tilt > prev_tilt + ALIGN_DIVERGE_MARGIN_DEG:
                worsen_streak += 1
            else:
                worsen_streak = 0
            prev_tilt = tilt
            rec.snap(robot, cam, state, f"step{step+1:03d}_{axis}",
                     {"axis": axis, "tilt": tilt, "rmse_mm": rmse_mm,
                      "depth_range_mm": depth_range_mm, "worsen_streak": worsen_streak,
                      "sign_rx": signs["rx"], "sign_ry": signs["ry"]})

            # ── re-probe-on-worsen ──────────────────────────────────────────
            # A sign learned once at the start (hardware 2026-07-27) can stop
            # holding partway through a large-tilt trajectory — e.g. ry
            # learned +1 from a clear probe signal, was the reliable
            # corrector for 3 steps, then started making tilt WORSE for the
            # rest of the run with the same sign still in force. The FIRST
            # time last_axis's own step is the one that made tilt worse,
            # re-probe just that axis on the spot (bounded by
            # ALIGN_MAX_REPROBES so a genuinely bad situation still falls
            # through to the abort below instead of re-probing forever).
            if (worsen_streak == 1 and last_axis is not None
                    and reprobe_count < ALIGN_MAX_REPROBES):
                state.status = f"align: {last_axis} made tilt worse — re-probing its sign"
                rec.log(f"  [Align] {state.status}")
                new_sign = _probe_align_sign(robot, cam, state, last_axis, rec)
                if state.align_stop.is_set():
                    state.status = "align aborted"; break
                if new_sign is None:
                    state.status = "align: lost tracking of marked points — re-mark and retry"
                    rec.log(f"  [Align] {state.status}")
                    break
                if new_sign != signs[last_axis]:
                    rec.log(f"  [Align] sign_{last_axis} flipped "
                            f"{signs[last_axis]:+d} → {new_sign:+d}")
                signs[last_axis] = new_sign
                reprobe_count += 1
                worsen_streak = 0

            if worsen_streak >= ALIGN_DIVERGE_STREAK:
                state.status = (f"align: tilt worsened {worsen_streak} steps in a row "
                                 f"(now {tilt:.1f}°) — aborted, check recording "
                                 f"({rec.dir.name})")
                rec.log(f"  [Align] {state.status}")
                break

            if tilt <= ALIGN_TOL_DEG:
                state.status = f"align done  tilt={tilt:.1f}°  rmse={rmse_mm:.2f}mm"
                rec.log(f"  [Align] {state.status}")
                converged = True
                break

            gain         = ALIGN_GAIN_DEG     * (ALIGN_FINE_SCALE if fine else 1.0)
            max_step_deg = ALIGN_MAX_STEP_DEG * (ALIGN_FINE_SCALE if fine else 1.0)
            if axis == "rx":
                d_rx = max(-max_step_deg, min(max_step_deg, signs["rx"] * n_tool_y * gain))
                robot.rel_movl_tool(0, 0, 0, tool=WELD_TOOL_INDEX, drx=d_rx)
            else:
                d_ry = max(-max_step_deg, min(max_step_deg, signs["ry"] * -n_tool_x * gain))
                robot.rel_movl_tool(0, 0, 0, tool=WELD_TOOL_INDEX, dry=d_ry)
            last_axis = axis
        else:
            state.status = f"align: stopped — {max_steps} steps without converging"
            rec.log(f"  [Align] {state.status}")

        # ── phase 3: correct roll (Rz) — only once tilt has converged ──────
        if converged and not state.align_stop.is_set():
            _converge_rz(robot, cam, state, rec)
    except RobotMoveError as e:
        # The controller rejected a move (e.g. IK/out-of-working-area) —
        # before 2026-07-27g this was invisible: rel_movl_tool()/movl()
        # never checked the reply, _wait_stable() just saw the pose not
        # change and returned as if nothing were wrong, and the loop kept
        # issuing more commands into the same stuck state (on hardware:
        # tilt frozen at the same value for several "steps" in a row,
        # each logged as a normal re-center attempt). Now it's caught here
        # and reported plainly instead of silently spinning.
        state.status = f"align: robot rejected a move — {e} — aborted, check robot log"
        rec.log(f"  [Align] {state.status}")
    finally:
        state.align_running = False


def _continuous_tracking_loop(cam: Camera, state: AppState):
    """Runs FOREVER in its own daemon thread (see start_tracking_thread()) —
    the ONE AND ONLY object tracker in this app. Keeps state.points glued
    to the marked object in real time via depth-only region growing
    (_region_grow_measure — no color image, no per-point optical flow,
    replaced 2026-07-28). Also keeps state.last_center_depth updated
    (depth at the marked region's centroid, or image center if nothing's
    marked), and state.last_tilt/last_rmse/last_depth_range/last_roll_deg
    from a live plane fit, so you can sanity-check the measured tilt
    BEFORE ever pressing Align (no robot motion involved in any of this).

    Deliberately does NOT pause while do_align() is running (changed
    2026-07-25d) — do_align() no longer has its own tracker; it just reads
    state.points/state.tracking_ok, so this loop keeps tracking THROUGH
    the robot's rotation too, not just before/after each discrete move.
    Every call re-derives the region fresh from depth (no incremental
    per-frame accumulation), so there's nothing for drift to hide in the
    way there was with optical flow.

    Resets its tracking reference whenever state.points_gen changes (a
    fresh click via /api/point or /api/reset_points) instead of trying to
    grow from a stale seed left over from a previous mark.
    """
    tracked_gen = -1
    while True:
        if not cam._running:
            state.tracking_ok = False
            state._seed = None; state._prev_bbox = None
            sleep(0.15)
            continue

        if state.points:
            cx = sum(p[0] for p in state.points) / len(state.points)
            cy = sum(p[1] for p in state.points) / len(state.points)
        else:
            cx, cy = cam.w / 2, cam.h / 2
        d = cam.sample_depth(int(cx), int(cy))
        state.last_center_depth = d if d > 0 else None

        if not state.points:
            state.tracking_ok = False
            state._seed = None; state._prev_bbox = None
            sleep(0.15)
            continue

        if tracked_gen != state.points_gen:
            # fresh mark — reset the region-grow seed to the newly clicked
            # centroid instead of growing from wherever the last mark left off
            state._seed = None
            state._prev_bbox = None
            tracked_gen = state.points_gen

        if len(state.points) < 4:
            # Don't run region-growing until all 4 corners are marked — it
            # seeds from the CLICK CENTROID and OVERWRITES state.points
            # with whatever region it grows, so triggering it after just
            # 1-3 clicks clobbers the user's own in-progress marking
            # before they've finished. On hardware 2026-07-28i this showed
            # up as "mark just the first point and the rest fills itself
            # in" — exactly this overwrite happening one click early.
            # Small/tricky objects need the user's own precise 4 clicks;
            # only start tracking automatically once all 4 are down.
            state.tracking_ok = False
            sleep(0.05)
            continue

        result = _region_grow_measure(cam, state)
        if result is not None:
            _, _, tilt, rmse_mm, depth_range_mm, roll_deg = result
            state.last_tilt, state.last_rmse, state.last_depth_range = tilt, rmse_mm, depth_range_mm
            state.last_roll_deg = roll_deg
        # _region_grow_measure already set state.tracking_ok/state.points
        # (or tracking_ok=False, leaving state.points at its last known
        # value) — do_align() checks tracking_ok before trusting a
        # measurement; the display just looks briefly stale instead of
        # jumping to a wrong position.

        sleep(0.03)


def start_tracking_thread(cam: Camera, state: AppState):
    """Spawn the continuous background tracker as a daemon thread — call
    once at app startup (see main.py)."""
    t = threading.Thread(target=_continuous_tracking_loop, args=(cam, state), daemon=True)
    t.start()
    return t
