"""maps_point/motion.py — basic point-to-world positioning.

Pure "move XY to whatever's under this clicked pixel" actions — no
rotation, no touching down. Shared by align.py (the pre-align 'move to
center' step) and main.py (the standalone Goto click mode: mark vs goto
are two different things you can do with a click on the video).
"""
from .config import CAM_X_SIGN, CAM_Y_SIGN, CAM_TCP_OFFSET_X, CAM_TCP_OFFSET_Y, HOME_Z
from .logs import log
from .robot import Robot, RobotMoveError
from .camera import Camera


def cam_xy_to_robot(du: float, dv: float, depth: float, fx: float, fy: float) -> tuple:
    """Pixel offset (du=u-cx, dv=v-cy) + depth → robot-frame (dx,dy) delta,
    mm. Same axis mapping as pick_45degree.py's _cam_xy_to_robot: image-
    vertical (dv) drives robot X, image-horizontal (du) drives robot Y —
    confirmed via the arrow-key jog hardware test on this rig."""
    dx = -dv * depth / fy * CAM_X_SIGN
    dy =  du * depth / fx * CAM_Y_SIGN
    return dx, dy


def pixel_to_world_xy(cam: Camera, x_px: float, y_px: float, origin_xy: tuple,
                      depth: float = None):
    """Pixel → robot-frame XY using the depth at that pixel, relative to
    `origin_xy` (the robot's X,Y when the frame was captured). No motion —
    returns (tX, tY), or None if depth/intrinsics aren't available.

    `depth` overrides the reading for this call. Callers mapping a whole set
    of pixels pass one shared value so every point is scaled identically."""
    if depth is None:
        depth = cam.sample_depth(int(x_px), int(y_px))
    if depth <= 0:
        return None
    intr = cam.intrinsics
    if intr is None:
        return None
    dx, dy = cam_xy_to_robot(x_px - intr["cx"], y_px - intr["cy"],
                              depth, intr["fx"], intr["fy"])
    return (origin_xy[0] + dx + CAM_TCP_OFFSET_X,
            origin_xy[1] + dy + CAM_TCP_OFFSET_Y)


def goto_pixel(robot: Robot, cam: Camera, x_px: float, y_px: float, z: float = None):
    """Move the robot's XY to the world position under pixel (x_px,y_px),
    at height `z` (default HOME_Z) — a rough approach position, no
    CAM_TCP_OFFSET calibration assumed (see config.py's note). Keeps
    current Rx/Ry/Rz untouched. Returns (tX, tY, tZ) on success, or None
    if depth couldn't be read at that pixel — caller must abort, not
    guess.
    """
    # Re-assert our Tool/User frame before this read specifically — a
    # preceding rel_movl_tool(tool=N) call (align's rotation) can leave
    # the dashboard on a different Tool selection, which would make
    # get_pose() here report X/Y/Z in the WRONG frame and silently
    # corrupt the target computed below (see Robot.ensure_frame()'s
    # docstring — this used to live inside get_pose() itself, which
    # caused a worse regression: get_pose() is polled far too often
    # elsewhere for a Tool()/User() dashboard call on every single read).
    robot.ensure_frame()
    X, Y, Z, Rx, Ry, Rz = robot.get_pose()
    target = pixel_to_world_xy(cam, x_px, y_px, (X, Y))
    if target is None:
        return None
    tX, tY = target
    tZ = z if z is not None else (HOME_Z if HOME_Z else Z)
    robot.movl(tX, tY, tZ, Rx, Ry, Rz)
    return tX, tY, tZ


def do_goto(robot: Robot, cam: Camera, state, x_px: float, y_px: float):
    """Background-thread action for the web page's Goto click mode: move
    XY to the clicked pixel's world position, Z=HOME_Z. No rotation, no
    touching down — mirrors pick_45degree.py's do_goto_target ('T' key).
    Mutates state.status so /api/status reflects progress; `state` is
    align.AppState but left untyped here to avoid a circular import
    (align.py imports goto_pixel from this module)."""
    if not robot.connected or not cam._running:
        state.status = "goto: robot/camera not ready"
        return
    state.status = f"goto: moving to pixel ({x_px:.0f},{y_px:.0f})…"
    log(f"  [Goto] {state.status}")
    try:
        result = goto_pixel(robot, cam, x_px, y_px)
    except RobotMoveError as e:
        state.status = f"goto: robot rejected the move — {e}"
        log(f"  [Goto] {state.status}")
        return
    if result is None:
        state.status = "goto: no valid depth at that pixel — no guessing"
        log(f"  [Goto] {state.status}")
        return
    tX, tY, tZ = result
    state.status = f"goto done  ({tX:.1f}, {tY:.1f}, {tZ:.1f})"
    log(f"  [Goto] {state.status}")
