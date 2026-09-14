"""backend/routers/mapcontrol.py — FastAPI bridge to the maps_point control
package (Dobot CR5 + RealSense D455: align-to-plane, draw, jog, status).

Maps every Flask route from maps_point/main.py onto /api/map/... so the
same hardware-control logic can be driven from the web_robot frontend.
Module-level globals (robot/cam/state + the continuous tracking thread)
mirror maps_point/main.py's setup exactly.
"""
import threading
import time
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from maps_point.config import (ROBOT_IP, ROBOT_MODE_LABELS,
                               DRAW_GRID_MAX_ROWS, DRAW_GRID_MAX_COLS)
from maps_point.logs import log, server_ring, robot_ring
from maps_point.robot import Robot, RobotMoveError
from maps_point.camera import Camera
from maps_point.align import AppState, do_align, start_tracking_thread
from maps_point.motion import do_goto
from maps_point.planegrid import do_draw, validate_grid, project_grid_2d
from maps_point.render import draw_overlay

router = APIRouter(prefix="/api/map", tags=["MapControl"])

# Module-level singletons — same as maps_point/main.py globals.
robot = Robot(ROBOT_IP)
cam = Camera()
state = AppState()
start_tracking_thread(cam, state)   # keeps state.points glued to the object


class ConnectBody(BaseModel):
    ip: Optional[str] = None
    dashboard_port: Optional[int] = None
    move_port: Optional[int] = None


class PointBody(BaseModel):
    x: int
    y: int


class GotoBody(BaseModel):
    x: float
    y: float


class JogBody(BaseModel):
    axis: str            # x/y/z/rx/ry/rz
    amount: float = 0.0
    speed: int = 10      # SpeedFactor 1-100 (percent)


class JogJointBody(BaseModel):
    joint: int
    amount: float = 0.0
    speed: int = 10      # SpeedFactor 1-100 (percent)


class MoveToBody(BaseModel):
    mode: str = "movj"   # "movj" | "movl" | "joint"
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    rx: Optional[float] = None
    ry: Optional[float] = None
    rz: Optional[float] = None
    joints: Optional[list] = None
    speed: int = 20      # SpeedFactor 1-100 (percent)


class FrameBody(BaseModel):
    tool_index: Optional[int] = None
    user_index: Optional[int] = None


class GridSizeBody(BaseModel):
    rows: int
    cols: int


class GridMarkBody(BaseModel):
    row: int
    col: int


class CliBody(BaseModel):
    cmd: str = ""


class DrawBody(BaseModel):
    strokes: list = []


class CameraModeBody(BaseModel):
    mode: str  # "rgb" or "gray"


# ── helpers (mirror maps_point/main.py) ──────────────────────────────────────
def _safe_call(fn, *args, **kwargs):
    """Run a Robot method as a thread target with RobotMoveError caught
    and logged instead of printing an unhandled traceback."""
    try:
        fn(*args, **kwargs)
    except RobotMoveError as e:
        log(f"  [Robot] move rejected — {e}")


def _set_grid_size(rows: int, cols: int):
    if not (2 <= rows <= DRAW_GRID_MAX_ROWS and 2 <= cols <= DRAW_GRID_MAX_COLS):
        return False, (f"grid size must be 2..{DRAW_GRID_MAX_ROWS} rows, "
                        f"2..{DRAW_GRID_MAX_COLS} cols")
    state.grid_rows = rows
    state.grid_cols = cols
    state.grid_points = [[None] * cols for _ in range(rows)]
    return True, f"grid set to {rows}x{cols} (cleared)"


def _mark_grid_point(row_1based: int, col_1based: int):
    row, col = row_1based - 1, col_1based - 1
    if not (0 <= row < state.grid_rows and 0 <= col < state.grid_cols):
        return False, f"row/col out of range (grid is {state.grid_rows}x{state.grid_cols})"
    if not robot.connected:
        return False, "not connected"
    robot.ensure_frame()
    pose = robot.get_pose()
    state.grid_points[row][col] = pose
    return True, f"marked R{row_1based}C{col_1based} = {[round(v, 1) for v in pose]}"


def _grid_fully_marked() -> bool:
    return all(state.grid_points[i][j] is not None
               for i in range(state.grid_rows) for j in range(state.grid_cols))


STREAM_FPS = 25
STREAM_W = 640
STREAM_H = 360
STREAM_JPEG_QUALITY = 70


def _colorize_depth(df):
    vmax = int(df.max())
    if vmax <= 0:
        vmax = 1
    norm = cv2.convertScaleAbs(df, alpha=255.0 / vmax)
    return cv2.applyColorMap(norm, cv2.COLORMAP_JET)


def _mjpeg_generator(mode: Optional[str] = None):
    """MJPEG generator — reads from shared buffers, NOT from hardware directly.
    
    Multiple clients can run this generator simultaneously without conflict.
    The capture thread in Camera class handles hardware access. Work is
    deduplicated by the camera frame counter and rate-limited to STREAM_FPS
    so an idle viewer cannot spin the JPEG encoder at 100% CPU.
    """
    interval = 1.0 / STREAM_FPS
    last_count = -1
    while True:
        loop_start = time.time()
        if not cam._running:
            time.sleep(0.2)
            continue

        cf, df = cam.get_latest_frames_ref()
        if cf is None:
            time.sleep(0.02)
            continue

        count = cam._frame_count
        if count == last_count:
            time.sleep(0.004)
            continue
        last_count = count

        effective_mode = (mode or getattr(state, "camera_mode", "rgb")).lower()

        if (effective_mode == "depth" or state.heatmap_mode) and df is not None:
            frame = _colorize_depth(df)
        elif effective_mode == "gray":
            frame = cv2.cvtColor(cf, cv2.COLOR_BGR2GRAY)
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        else:
            frame = cf.copy()

        frame = draw_overlay(frame, state)
        if frame.shape[1] != STREAM_W or frame.shape[0] != STREAM_H:
            frame = cv2.resize(frame, (STREAM_W, STREAM_H), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), STREAM_JPEG_QUALITY])
        if not ok:
            continue
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")

        dt = time.time() - loop_start
        if dt < interval:
            time.sleep(interval - dt)


# ── video stream ─────────────────────────────────────────────────────────────
_STREAM_HEADERS = {
    "X-Accel-Buffering": "no",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


@router.get("/video_feed")
def video_feed(mode: Optional[str] = None):
    return StreamingResponse(_mjpeg_generator(mode=mode),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers=_STREAM_HEADERS)


# ── robot / camera lifecycle ─────────────────────────────────────────────────
@router.post("/connect")
def api_connect(body: Optional[ConnectBody] = None):
    if body:
        robot.connect(ip=body.ip, dashboard_port=body.dashboard_port, move_port=body.move_port)
    else:
        robot.connect()
    return {"ok": robot.connected}


@router.post("/init")
def api_init():
    robot.init_robot()
    return {"ok": True, "connected": robot.connected}


@router.post("/camstart")
def api_camstart():
    ok = cam.start()
    return {"ok": ok}


@router.post("/error")
def api_error():
    robot.clear_error()
    return {"ok": True}


@router.post("/home")
def api_home():
    try:
        robot.go_home()
    except RobotMoveError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True}


# ── marking / clicking ───────────────────────────────────────────────────────
@router.post("/point")
def api_point(body: PointBody):
    if len(state.points) >= 4:
        state.points = []
    state.points.append((body.x, body.y))
    state.points_gen += 1   # fresh ground truth for the tracker
    return {"ok": True, "points": state.points}


@router.post("/goto")
def api_goto(body: GotoBody):
    if not robot.connected or not cam._running:
        return {"ok": False, "error": "robot/camera not ready"}
    threading.Thread(target=do_goto, args=(robot, cam, state, body.x, body.y),
                     daemon=True).start()
    return {"ok": True}


@router.post("/reset_points")
def api_reset_points():
    state.points = []
    state.points_gen += 1
    return {"ok": True}


@router.post("/heatmap/toggle")
def api_heatmap_toggle():
    state.heatmap_mode = not state.heatmap_mode
    return {"ok": True, "heatmap_mode": state.heatmap_mode}


@router.get("/camera_mode")
def api_get_camera_mode():
    return {"mode": getattr(state, "camera_mode", "rgb")}


@router.post("/camera_mode")
def api_set_camera_mode(body: CameraModeBody):
    m = body.mode.lower()
    if m not in ("rgb", "gray", "depth"):
        return {"ok": False, "error": f"Invalid mode: {body.mode}. Expected 'rgb', 'gray', or 'depth'"}
    state.camera_mode = m
    return {"ok": True, "mode": state.camera_mode}


@router.post("/camera_mode/toggle")
def api_toggle_camera_mode():
    modes = ["rgb", "gray", "depth"]
    current = getattr(state, "camera_mode", "rgb")
    next_idx = (modes.index(current) + 1) % len(modes) if current in modes else 0
    state.camera_mode = modes[next_idx]
    return {"ok": True, "mode": state.camera_mode}


# ── jog ──────────────────────────────────────────────────────────────────────
@router.post("/jog")
def api_jog(body: JogBody):
    if body.axis not in ("x", "y", "z", "rx", "ry", "rz"):
        return {"ok": False, "error": "axis must be x/y/z/rx/ry/rz"}
    if not robot.connected:
        return {"ok": False, "error": "not connected"}
    # Apply speed (1-100%) before jog
    speed = max(1, min(100, body.speed))
    robot.dashboard.SpeedFactor(speed)
    threading.Thread(target=_safe_call, args=(robot.jog_cartesian,),
                     kwargs={f"d{body.axis}": body.amount}, daemon=True).start()
    return {"ok": True}


@router.post("/jog_joint")
def api_jog_joint(body: JogJointBody):
    if not (1 <= body.joint <= 6):
        return {"ok": False, "error": "joint must be 1-6"}
    if not robot.connected:
        return {"ok": False, "error": "not connected"}
    # Apply speed (1-100%) before jog
    speed = max(1, min(100, body.speed))
    robot.dashboard.SpeedFactor(speed)
    threading.Thread(target=_safe_call, args=(robot.jog_joint,),
                     kwargs={f"j{body.joint}": body.amount}, daemon=True).start()
    return {"ok": True}


@router.post("/move_to")
def api_move_to(body: MoveToBody):
    if not robot.connected:
        return {"ok": False, "error": "Robot not connected"}
    mode = (body.mode or "movj").lower()
    speed = max(1, min(100, body.speed or 20))

    if mode == "joint":
        if not body.joints or len(body.joints) < 6:
            return {"ok": False, "error": "joints must contain 6 angles [J1..J6]"}
        j = [float(val) for val in body.joints[:6]]
        threading.Thread(target=_safe_call, args=(robot.joint_movj,),
                         kwargs={"j1": j[0], "j2": j[1], "j3": j[2],
                                 "j4": j[3], "j5": j[4], "j6": j[5],
                                 "speed": speed}, daemon=True).start()
        return {"ok": True, "mode": "joint", "joints": j}

    elif mode in ("movj", "movl"):
        if None in (body.x, body.y, body.z, body.rx, body.ry, body.rz):
            return {"ok": False, "error": "x, y, z, rx, ry, rz must all be provided"}
        target_fn = robot.movj if mode == "movj" else robot.movl
        threading.Thread(target=_safe_call, args=(target_fn,),
                         kwargs={"x": float(body.x), "y": float(body.y), "z": float(body.z),
                                 "rx": float(body.rx), "ry": float(body.ry), "rz": float(body.rz),
                                 "speed": speed}, daemon=True).start()
        return {"ok": True, "mode": mode, "coords": [body.x, body.y, body.z, body.rx, body.ry, body.rz]}

    return {"ok": False, "error": f"Invalid mode: {body.mode}"}


@router.post("/frame")
def api_frame(body: FrameBody):
    robot.set_frame(
        tool_index=body.tool_index,
        user_index=body.user_index,
    )
    return {"ok": True, "tool_index": robot.tool_index, "user_index": robot.user_index}


# ── align ────────────────────────────────────────────────────────────────────
@router.post("/align")
def api_align():
    if len(state.points) < 4:
        return {"ok": False, "error": "need 4 points"}
    if state.align_running or state.draw_running:
        return {"ok": False, "error": "already running"}
    threading.Thread(target=do_align, args=(robot, cam, state), daemon=True).start()
    return {"ok": True}


@router.post("/align/stop")
def api_align_stop():
    state.align_stop.set()
    return {"ok": True}


# ── draw grid ────────────────────────────────────────────────────────────────
@router.post("/grid/size")
def api_grid_size(body: GridSizeBody):
    ok, msg = _set_grid_size(body.rows, body.cols)
    if not ok:
        return {"ok": False, "error": msg}
    return {"ok": True, "rows": state.grid_rows, "cols": state.grid_cols}


@router.post("/grid/mark")
def api_grid_mark(body: GridMarkBody):
    ok, msg = _mark_grid_point(body.row, body.col)
    if not ok:
        return {"ok": False, "error": msg}
    return {"ok": True, "message": msg, "grid_points": state.grid_points}


@router.post("/grid/reset")
def api_grid_reset():
    for i in range(state.grid_rows):
        for j in range(state.grid_cols):
            state.grid_points[i][j] = None
    return {"ok": True}


@router.post("/draw")
def api_draw(body: DrawBody):
    if not isinstance(body.strokes, list) or not body.strokes:
        return {"ok": False, "error": "invalid strokes"}
    strokes = []
    try:
        for s in body.strokes:
            if not isinstance(s, dict):
                continue
            pts = [(float(p[0]), float(p[1])) for p in s.get("points", [])]
            if pts:
                strokes.append({"tool": s.get("tool", "pen"), "points": pts})
    except (TypeError, ValueError, IndexError, AttributeError):
        return {"ok": False, "error": "invalid strokes"}
    if not strokes:
        return {"ok": False, "error": "invalid strokes"}
    if not _grid_fully_marked():
        return {"ok": False, "error": "grid not fully marked"}
    if state.align_running or state.draw_running:
        return {"ok": False, "error": "already running"}
    threading.Thread(target=do_draw, args=(robot, state, strokes), daemon=True).start()
    return {"ok": True}


@router.post("/draw/stop")
def api_draw_stop():
    state.draw_stop.set()
    return {"ok": True}


# ── status / logs / cli ──────────────────────────────────────────────────────
@router.get("/status")
def api_status():
    pose = robot.get_pose() if robot.connected else [0.0] * 6
    angles = robot.get_angle() if robot.connected else [0.0] * 6
    mode = robot.get_mode() if robot.connected else None
    return {
        "connected": robot.connected,
        "camera_running": cam._running,
        "cam_w": cam.w,
        "cam_h": cam.h,
        "stream_w": STREAM_W,
        "stream_h": STREAM_H,
        "pose": pose,
        "angles": angles,
        "tool_index": robot.tool_index,
        "user_index": robot.user_index,
        "robot_mode": mode,
        "robot_mode_label": ROBOT_MODE_LABELS.get(mode, "?"),
        "points": state.points,
        "align_running": state.align_running,
        "last_tilt": state.last_tilt,
        "last_rmse": state.last_rmse,
        "last_depth_range": state.last_depth_range,
        "last_roll_deg": state.last_roll_deg,
        "last_center_depth": state.last_center_depth,
        "heatmap_mode": state.heatmap_mode,
        "camera_mode": getattr(state, "camera_mode", "rgb"),
        "grid_rows": state.grid_rows,
        "grid_cols": state.grid_cols,
        "grid_points": state.grid_points,
        "grid_validate": (validate_grid(state.grid_points, state.grid_rows, state.grid_cols)
                          if _grid_fully_marked() else None),
        "grid_shape_2d": (project_grid_2d(state.grid_points, state.grid_rows, state.grid_cols)
                          if _grid_fully_marked() else None),
        "draw_running": state.draw_running,
        "status": state.status,
    }


@router.get("/logs")
def api_logs(since: int = Query(default=0)):
    entries, latest = server_ring.since(since)
    return {"entries": entries, "latest": latest}


@router.get("/robot_logs")
def api_robot_logs(since: int = Query(default=0)):
    entries, latest = robot_ring.since(since)
    return {"entries": entries, "latest": latest}


@router.post("/cli")
def api_cli(body: CliBody):
    output = _run_cli_command((body.cmd or "").strip())
    return {"ok": True, "output": output}


# ── CLI dispatcher (kept as string-level fallback, mirrors /api/cli) ────────
def _run_cli_command(raw: str) -> str:
    """CLI-command dispatcher equivalent to maps_point/main.py's, driving the
    same shared robot/cam/state singletons."""
    if not raw:
        return ""
    parts = raw.split()
    cmd, args = parts[0].lower(), parts[1:]

    if cmd == "init":
        robot.connect()
        robot.init_robot()
        return f"connected={robot.connected}"
    elif cmd == "camstart":
        ok = cam.start()
        return f"camera started={ok}"
    elif cmd in ("status", "s"):
        p = robot.get_pose()
        a = robot.get_angle()
        mode = robot.get_mode()
        return (f"pose  X={p[0]:.1f} Y={p[1]:.1f} Z={p[2]:.1f} "
                f"Rx={p[3]:.1f} Ry={p[4]:.1f} Rz={p[5]:.1f}\n"
                f"joints  J1={a[0]:.1f} J2={a[1]:.1f} J3={a[2]:.1f} "
                f"J4={a[3]:.1f} J5={a[4]:.1f} J6={a[5]:.1f}\n"
                f"connected={robot.connected}  camera_running={cam._running}\n"
                f"tool={robot.tool_index}  user={'(unset)' if robot.user_index is None else robot.user_index}\n"
                f"robot_mode={mode} ({ROBOT_MODE_LABELS.get(mode, '?')})\n"
                f"points={state.points}  align_running={state.align_running}\n"
                f"tilt={state.last_tilt}  rmse={state.last_rmse}  "
                f"depth_range={state.last_depth_range}  roll={state.last_roll_deg}  "
                f"center_depth={state.last_center_depth}\n"
                f"heatmap_mode={state.heatmap_mode}\n"
                f"grid={state.grid_rows}x{state.grid_cols}  "
                f"marked={sum(1 for i in range(state.grid_rows) for j in range(state.grid_cols) if state.grid_points[i][j] is not None)}"
                f"/{state.grid_rows * state.grid_cols}  draw_running={state.draw_running}\n"
                f"status={state.status}")
    elif cmd == "points":
        return f"points={state.points}"
    elif cmd == "reset":
        state.points = []
        state.points_gen += 1
        return "points cleared"
    elif cmd == "heatmap":
        state.heatmap_mode = not state.heatmap_mode
        return f"heatmap_mode={state.heatmap_mode}"
    elif cmd == "goto":
        if len(args) < 2:
            return "usage: goto <x_px> <y_px>"
        if not robot.connected or not cam._running:
            return "goto: robot/camera not ready"
        try:
            x, y = float(args[0]), float(args[1])
        except ValueError:
            return "usage: goto <x_px> <y_px>"
        threading.Thread(target=do_goto, args=(robot, cam, state, x, y), daemon=True).start()
        return "goto started"
    elif cmd == "align":
        if len(state.points) < 4:
            return "need 4 points first — click 4 corners on the video"
        if state.align_running or state.draw_running:
            return "already running"
        threading.Thread(target=do_align, args=(robot, cam, state), daemon=True).start()
        return "align started"
    elif cmd == "stop":
        state.align_stop.set()
        return "abort requested"
    elif cmd == "grid":
        if not args:
            return "usage: grid size <rows> <cols> | grid mark <row> <col> | grid reset"
        sub = args[0]
        if sub == "size":
            if len(args) < 3:
                return "usage: grid size <rows> <cols>"
            try:
                rows, cols = int(args[1]), int(args[2])
            except ValueError:
                return "usage: grid size <rows> <cols>"
            _, msg = _set_grid_size(rows, cols)
            return msg
        elif sub == "mark":
            if len(args) < 3:
                return "usage: grid mark <row> <col>  (1-indexed, e.g. R1C1)"
            try:
                row, col = int(args[1]), int(args[2])
            except ValueError:
                return "usage: grid mark <row> <col>"
            _, msg = _mark_grid_point(row, col)
            return msg
        elif sub == "reset":
            for i in range(state.grid_rows):
                for j in range(state.grid_cols):
                    state.grid_points[i][j] = None
            return "grid points cleared"
        else:
            return "usage: grid size <rows> <cols> | grid mark <row> <col> | grid reset"
    elif cmd == "draw":
        if args and args[0] == "stop":
            state.draw_stop.set()
            return "draw abort requested"
        return "usage: draw stop  (a stroke itself is submitted from the web page's canvas)"
    elif cmd == "home":
        try:
            robot.go_home()
        except RobotMoveError as e:
            return f"home: robot rejected the move — {e}"
        return "moving home"
    elif cmd == "jog":
        if len(args) < 2 or args[0] not in ("x", "y", "z", "rx", "ry", "rz"):
            return "usage: jog <x|y|z|rx|ry|rz> <amount_mm_or_deg>"
        if not robot.connected:
            return "jog: not connected"
        try:
            amount = float(args[1])
        except ValueError:
            return "usage: jog <x|y|z|rx|ry|rz> <amount_mm_or_deg>"
        kwargs = {("d" + args[0]): amount}
        threading.Thread(target=_safe_call, args=(robot.jog_cartesian,), kwargs=kwargs, daemon=True).start()
        return f"jog {args[0]} {amount:+g} started"
    elif cmd == "jogj":
        if len(args) < 2:
            return "usage: jogj <1-6> <amount_deg>"
        if not robot.connected:
            return "jogj: not connected"
        try:
            j = int(args[0]); amount = float(args[1])
        except ValueError:
            return "usage: jogj <1-6> <amount_deg>"
        if not (1 <= j <= 6):
            return "joint must be 1-6"
        kwargs = {f"j{j}": amount}
        threading.Thread(target=_safe_call, args=(robot.jog_joint,), kwargs=kwargs, daemon=True).start()
        return f"jog joint J{j} {amount:+g}° started"
    elif cmd == "frame":
        if not args:
            return (f"tool={robot.tool_index}  "
                    f"user={'(unset)' if robot.user_index is None else robot.user_index}")
        try:
            tool_index = None if args[0] == "-" else int(args[0])
            user_index = None if len(args) < 2 or args[1] == "-" else int(args[1])
        except ValueError:
            return "usage: frame <tool_index> [user_index]  (- = leave unchanged, user -1 = unset)"
        robot.set_frame(tool_index=tool_index, user_index=user_index)
        return (f"tool={robot.tool_index}  "
                f"user={'(unset)' if robot.user_index is None else robot.user_index}")
    elif cmd in ("error", "e"):
        robot.clear_error()
        return "error cleared + reset"
    elif cmd in ("help", "?", "h"):
        return ("commands: init, camstart, status, points, reset, heatmap, "
                "goto <x> <y>, align, stop, home, error, "
                "frame [tool] [user]  (- = leave unchanged, user -1 = unset), "
                "jog <x|y|z|rx|ry|rz> <amount>, jogj <1-6> <amount_deg>, "
                "grid size <rows> <cols> | grid mark <row> <col> | grid reset, "
                "draw stop  (submitting a stroke itself is done from the web page canvas)")
    else:
        return f"unknown command: '{cmd}'  (type 'help')"