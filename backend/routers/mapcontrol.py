"""backend/routers/mapcontrol.py — FastAPI bridge to the maps_point control
package (Dobot CR5 + RealSense D455: align-to-plane, draw, jog, status).

Maps every Flask route from maps_point/main.py onto /api/map/... so the
same hardware-control logic can be driven from the web_robot frontend.
Module-level globals (robot/cam/state + the continuous tracking thread)
mirror maps_point/main.py's setup exactly.
"""
import math
import threading
import time
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from maps_point.config import (ROBOT_IP, ROBOT_MODE_LABELS,
                               DRAW_GRID_MAX_ROWS, DRAW_GRID_MAX_COLS,
                               DRAW_MIN_GRID_SPAN_MM, Z_SURFACE,
                               CAM_TIP_OFFSET_MM, DRAW_SURFACE_GAP_MM)
from maps_point.logs import log, server_ring, robot_ring
from maps_point.robot import Robot, RobotMoveError
from maps_point.camera import Camera
from maps_point.align import AppState, do_align, start_tracking_thread
from maps_point.motion import do_goto, pixel_to_world_xy
from maps_point import floorcalib
from maps_point.planegrid import do_draw, validate_grid, project_grid_2d, bilinear_cell, grid_pose
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


class MoveSequencePoint(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    rx: Optional[float] = None
    ry: Optional[float] = None
    rz: Optional[float] = None
    joints: Optional[list] = None


class MoveSequenceBody(BaseModel):
    points: list[MoveSequencePoint] = []
    mode: Optional[str] = "movj"  # "movj", "movl", or "joint"
    speed: Optional[int] = 20     # 1..100
    pause_s: Optional[float] = 0.5  # dwell pause in seconds between points


# ── helpers (mirror maps_point/main.py) ──────────────────────────────────────
sequence_running = False
sequence_index = 0
sequence_total = 0
sequence_stop = threading.Event()


def _do_move_sequence(robot_inst, points, mode, speed, pause_s):
    global sequence_running, sequence_index, sequence_total
    sequence_running = True
    sequence_stop.clear()
    sequence_total = len(points)
    log(f"  [Sequence] Start executing {sequence_total} points (mode={mode}, speed={speed}%, pause={pause_s}s)")
    try:
        for idx, pt in enumerate(points):
            if sequence_stop.is_set():
                log(f"  [Sequence] Stopped by user at point {idx + 1}/{sequence_total}")
                break
            sequence_index = idx + 1
            log(f"  [Sequence] Moving to point {sequence_index}/{sequence_total}...")

            if mode == "joint" and pt.joints and len(pt.joints) >= 6:
                j = [float(val) for val in pt.joints[:6]]
                robot_inst.joint_movj(j1=j[0], j2=j[1], j3=j[2], j4=j[3], j5=j[4], j6=j[5], speed=speed)
            else:
                if None in (pt.x, pt.y, pt.z, pt.rx, pt.ry, pt.rz):
                    if pt.joints and len(pt.joints) >= 6:
                        j = [float(val) for val in pt.joints[:6]]
                        robot_inst.joint_movj(j1=j[0], j2=j[1], j3=j[2], j4=j[3], j5=j[4], j6=j[5], speed=speed)
                    else:
                        log(f"  [Sequence] Skipping point {sequence_index}: missing coordinates/joints")
                        continue
                else:
                    move_fn = robot_inst.movj if mode == "movj" else robot_inst.movl
                    move_fn(x=float(pt.x), y=float(pt.y), z=float(pt.z),
                            rx=float(pt.rx), ry=float(pt.ry), rz=float(pt.rz),
                            speed=speed)

            if pause_s > 0:
                elapsed = 0.0
                while elapsed < pause_s:
                    if sequence_stop.is_set():
                        break
                    time.sleep(0.05)
                    elapsed += 0.05

        if sequence_stop.is_set():
            robot_inst.clear_error()
            log("  [Sequence] Aborted.")
        else:
            log(f"  [Sequence] Completed all {sequence_total} points successfully.")
    except Exception as e:
        log(f"  [Sequence] Error during sequence: {e}")
    finally:
        sequence_running = False


def _safe_call(fn, *args, **kwargs):
    """Run a Robot method as a thread target, logging any failure instead of
    letting the daemon thread die with an unhandled traceback. Keep the
    generic branch: a socket timeout (robot unplugged mid-session) used to
    vanish silently here, so the UI just looked like nothing happened."""
    try:
        fn(*args, **kwargs)
    except RobotMoveError as e:
        log(f"  [Robot] move rejected — {e}")
    except Exception as e:
        log(f"  [Robot] call failed — {type(e).__name__}: {e}")


def _set_grid_size(rows: int, cols: int):
    if not (2 <= rows <= DRAW_GRID_MAX_ROWS and 2 <= cols <= DRAW_GRID_MAX_COLS):
        return False, (f"grid size must be 2..{DRAW_GRID_MAX_ROWS} rows, "
                        f"2..{DRAW_GRID_MAX_COLS} cols")
    state.grid_rows = rows
    state.grid_cols = cols
    state.grid_points = [[None] * cols for _ in range(rows)]
    return True, f"grid set to {rows}x{cols} (cleared)"


GRID_DUP_POS_MM = 1.0
GRID_DUP_ROT_DEG = 1.0


def _poses_match(a, b) -> bool:
    return (max(abs(a[i] - b[i]) for i in range(3)) < GRID_DUP_POS_MM
            and max(abs(a[i] - b[i]) for i in range(3, 6)) < GRID_DUP_ROT_DEG)


def _grid_span_mm() -> float:
    pts = [p for row in state.grid_points for p in row if p is not None]
    if len(pts) < 2:
        return 0.0
    return max(max(p[k] for p in pts) - min(p[k] for p in pts) for k in range(3))


def _sort_corners(pts):
    """Order 4 image points as [top-left, top-right, bottom-right,
    bottom-left] by angle around their centroid — a click order the user
    can't get wrong still fills the grid the right way round."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    ordered = sorted(pts, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    start = min(range(len(ordered)), key=lambda k: ordered[k][0] + ordered[k][1])
    ordered = ordered[start:] + ordered[:start]
    if ordered[1][0] < ordered[0][0]:
        ordered = [ordered[0]] + list(reversed(ordered[1:]))
    return ordered


def _mark_grid_point(row_1based: int, col_1based: int):
    row, col = row_1based - 1, col_1based - 1
    if not (0 <= row < state.grid_rows and 0 <= col < state.grid_cols):
        return False, f"row/col out of range (grid is {state.grid_rows}x{state.grid_cols})"
    if not robot.connected:
        return False, "not connected"
    robot.ensure_frame()
    pose = robot.get_pose()
    for i in range(state.grid_rows):
        for j in range(state.grid_cols):
            if i == row and j == col:
                continue
            other = state.grid_points[i][j]
            if other is not None and _poses_match(pose, other):
                return False, (f"R{row_1based}C{col_1based} is the same pose as R{i + 1}C{j + 1} — "
                               f"jog the robot to this corner before marking")
    state.grid_points[row][col] = pose
    return True, f"marked R{row_1based}C{col_1based} = {[round(v, 1) for v in pose]}"


def _grid_fully_marked() -> bool:
    return all(state.grid_points[i][j] is not None
               for i in range(state.grid_rows) for j in range(state.grid_cols))


STREAM_FPS = 30
STREAM_FPS_IDLE = 30
STREAM_W = 640
STREAM_H = 360
STREAM_JPEG_QUALITY = 70


def _colorize_depth(df):
    vmax = int(df.max())
    if vmax <= 0:
        vmax = 1
    norm = cv2.convertScaleAbs(df, alpha=255.0 / vmax)
    return cv2.applyColorMap(norm, cv2.COLORMAP_JET)


_ENC_LOCK = threading.Lock()
_ENC_CACHE: dict = {}
_ENC_CACHE_MAX = 4


def _encode_frame(cf, df, effective_mode: str, count: int):
    """Encode the shared latest frame ONCE and hand the bytes to every viewer.

    Each client used to run its own colorize / draw_overlay / resize / JPEG
    pass, so N viewers meant N copies of identical work on the same frame —
    measured 2026-09-16 on the Pi: two viewers held ~25% of one core
    (tid 175 = 13.0%, tid 306 = 12.0%). The key is the capture frame counter,
    not app state: draw_overlay reads last_tilt / last_rmse / last_roll_deg,
    which the tracking loop rewrites every ~30ms, so a state key never hits.
    """
    key = (count, effective_mode, bool(state.heatmap_mode))
    hit = _ENC_CACHE.get(key)
    if hit is not None:
        return hit

    with _ENC_LOCK:
        hit = _ENC_CACHE.get(key)
        if hit is not None:
            return hit

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
            return None

        payload = buf.tobytes()
        if len(_ENC_CACHE) >= _ENC_CACHE_MAX:
            _ENC_CACHE.clear()
        _ENC_CACHE[key] = payload
        return payload


def _mjpeg_generator(mode: Optional[str] = None):
    """MJPEG generator — reads from shared buffers, NOT from hardware directly.

    Multiple clients can run this generator simultaneously without conflict.
    The capture thread in Camera class handles hardware access. The JPEG
    encode itself is shared across viewers via _encode_frame.

    Pacing: the previous version slept for the remainder of a 1/fps window
    after every yield, which added up to 67ms of pure delay on top of the
    encode cost whenever the stream was idle (STREAM_FPS_IDLE was 15 against
    a 30fps camera). The stream is already gated by "only send when the
    capture counter advanced", so that throttle only ever added LATENCY —
    every displayed frame was one to two frames behind the live scene. The
    loop now yields the instant a new frame exists and only sleeps while
    waiting for one.
    """
    last_count = -1
    while True:
        if not cam._running:
            time.sleep(0.2)
            continue

        cf, df = cam.get_latest_frames_ref()
        if cf is None:
            time.sleep(0.01)
            continue

        count = cam._frame_count
        if count == last_count:
            time.sleep(0.002)
            continue
        last_count = count

        effective_mode = (mode or getattr(state, "camera_mode", "rgb")).lower()
        payload = _encode_frame(cf, df, effective_mode, count)
        if payload is None:
            continue
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + payload + b"\r\n")


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
    global sequence_running
    sequence_stop.set()
    robot.clear_error()
    return {"ok": True}


@router.post("/emergency")
def api_emergency():
    global sequence_running
    sequence_stop.set()
    sequence_running = False
    state.align_stop.set()
    state.draw_stop.set()
    state.align_running = False
    state.draw_running = False
    if robot.connected:
        robot.emergency_stop()
    return {"ok": True, "status": "emergency_stop_triggered"}


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


# ── floor calibration (fixed overhead camera → robot XY homography) ──────────
class FloorPointBody(BaseModel):
    u: float
    v: float


class FloorGotoBody(BaseModel):
    u: float
    v: float
    lift: float = 0.0


class FloorZBody(BaseModel):
    z: float


def _floor_status():
    pairs, h, fz = floorcalib.load()
    return {
        "ok": True,
        "calibrated": h is not None,
        "count": len(pairs),
        "min_points": floorcalib.MIN_POINTS,
        "points": [{"u": u, "v": v, "X": X, "Y": Y} for (u, v), (X, Y) in pairs],
        "rmse_mm": None if h is None else floorcalib.reprojection_rmse(h, pairs),
        "floor_z": fz,
        "H": None if h is None else h.tolist(),
        "H_inv": None if h is None else floorcalib.invert(h),
    }


@router.get("/floorcalib")
def api_floorcalib_status():
    return _floor_status()


@router.post("/floorcalib/point")
def api_floorcalib_add(body: FloorPointBody):
    if not robot.connected:
        return {"ok": False, "error": "robot not connected"}
    robot.ensure_frame()
    X, Y, Z = robot.get_pose()[:3]
    pairs, _h, _fz = floorcalib.load()
    pairs = [p for p in pairs if abs(p[0][0] - body.u) > 1 or abs(p[0][1] - body.v) > 1]
    pairs.append(((float(body.u), float(body.v)), (X, Y)))
    h = floorcalib.compute_homography(pairs)
    floorcalib.save(pairs, h, floor_z=Z)
    return _floor_status()


@router.post("/floorcalib/reset")
def api_floorcalib_reset():
    floorcalib.save([], None, None)
    return _floor_status()


@router.post("/floorcalib/floorz")
def api_floorcalib_setz(body: FloorZBody):
    pairs, h, _fz = floorcalib.load()
    floorcalib.save(pairs, h, floor_z=body.z)
    return _floor_status()


def _do_floor_goto(X: float, Y: float, fz, lift: float):
    try:
        robot.ensure_frame()
        cur = robot.get_pose()
        tZ = (fz if fz is not None else cur[2]) + lift
        robot.movl(X, Y, tZ, cur[3], cur[4], cur[5])
        state.status = f"floor-goto done ({X:.1f}, {Y:.1f}, {tZ:.1f})"
    except RobotMoveError as e:
        state.status = f"floor-goto rejected — {e}"
    log(f"  [Floor] {state.status}")


@router.post("/floorcalib/goto")
def api_floorcalib_goto(body: FloorGotoBody):
    if not robot.connected:
        return {"ok": False, "error": "robot not connected"}
    _pairs, h, fz = floorcalib.load()
    if h is None:
        return {"ok": False, "error": "not calibrated (need >= 4 points)"}
    xy = floorcalib.apply_homography(h, body.u, body.v)
    if xy is None:
        return {"ok": False, "error": "pixel maps to infinity"}
    threading.Thread(target=_do_floor_goto, args=(xy[0], xy[1], fz, body.lift),
                     daemon=True).start()
    return {"ok": True, "target": {"X": xy[0], "Y": xy[1]}}


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
    global sequence_running
    if not robot.connected:
        return {"ok": False, "error": "Robot not connected"}
    if sequence_running:
        return {"ok": False, "error": "Robot motion sequence is currently running"}
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


@router.post("/move_sequence")
def api_move_sequence(body: MoveSequenceBody):
    global sequence_running
    if not robot.connected:
        return {"ok": False, "error": "Robot not connected"}
    if sequence_running or state.align_running or state.draw_running:
        return {"ok": False, "error": "Robot motion already running"}
    if not body.points:
        return {"ok": False, "error": "No points provided in sequence"}

    mode = (body.mode or "movj").lower()
    speed = max(1, min(100, body.speed or 20))
    pause_s = max(0.0, min(10.0, float(body.pause_s if body.pause_s is not None else 0.5)))

    threading.Thread(
        target=_do_move_sequence,
        args=(robot, body.points, mode, speed, pause_s),
        daemon=True,
    ).start()

    return {"ok": True, "total": len(body.points), "mode": mode, "speed": speed, "pause_s": pause_s}


@router.post("/move_sequence/stop")
def api_move_sequence_stop():
    global sequence_running
    sequence_stop.set()
    if robot.connected:
        try:
            robot.clear_error()
        except Exception:
            pass
    return {"ok": True}


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


@router.post("/grid/autofill")
def api_grid_autofill():
    """Fill the whole grid from the 4 image points already marked on the
    feed, so no jogging is needed. Each pixel maps to robot XY AND its own
    surface Z via the depth at that pixel (the camera rides on the arm, so
    it is relative to the CURRENT pose — same maths as motion.goto_pixel).
    Orientation comes from the current pose, i.e. the plane align() just
    squared the tool to. The robot does not move.

    Z must come from the depth reading, not the current pose Z: the pose Z
    is wherever the arm happens to be hovering, so using it puts the whole
    grid that far ABOVE the workpiece and the pen never touches down
    (measured 2026-09-28: pose Z 568.4 vs surface ~135 — 433mm too high)."""
    if not robot.connected or not cam._running:
        return {"ok": False, "error": "robot/camera not ready"}
    pts = list(state.points)
    if len(pts) < 4:
        return {"ok": False, "error": "mark 4 corner points on the image first"}
    if cam.intrinsics is None:
        return {"ok": False, "error": "camera intrinsics not ready"}
    robot.ensure_frame()
    X, Y, Z, Rx, Ry, Rz = robot.get_pose()
    tl, tr, br, bl = _sort_corners(pts[:4])
    corners = {}
    for name, (px, py) in (("top-left", tl), ("top-right", tr),
                           ("bottom-right", br), ("bottom-left", bl)):
        xy = pixel_to_world_xy(cam, px, py, (X, Y))
        if xy is None:
            return {"ok": False,
                    "error": f"no depth at the {name} point ({px},{py}) — "
                             f"re-mark it on the object surface"}
        depth = cam.sample_depth(int(px), int(py))
        if depth <= 0:
            return {"ok": False,
                    "error": f"no depth reading at the {name} point ({px},{py}) — "
                             f"re-mark it on the object surface"}
        surface_z = Z - depth + CAM_TIP_OFFSET_MM + DRAW_SURFACE_GAP_MM
        corners[name] = [xy[0], xy[1], surface_z, Rx, Ry, Rz]

    rows, cols = state.grid_rows, state.grid_cols
    grid = [[None] * cols for _ in range(rows)]
    for i in range(rows):
        lv = i / (rows - 1) if rows > 1 else 0.0
        for j in range(cols):
            lu = j / (cols - 1) if cols > 1 else 0.0
            grid[i][j] = bilinear_cell(lu, lv, corners["top-left"], corners["top-right"],
                                       corners["bottom-left"], corners["bottom-right"])
    state.grid_points = grid
    span = _grid_span_mm()
    zs = [grid[i][j][2] for i in range(rows) for j in range(cols)]
    state.status = (f"grid auto-filled from 4 marked points (span={span:.1f}mm, "
                    f"surface Z={sum(zs)/len(zs):.1f})")
    return {"ok": True, "grid_points": grid, "span_mm": span,
            "surface_z": sum(zs) / len(zs)}


class GridSetZBody(BaseModel):
    z: Optional[float] = None


@router.post("/grid/setz")
def api_grid_setz(body: GridSetZBody = GridSetZBody()):
    """Re-teach ONLY the Z + orientation of every marked grid cell, keeping
    each cell's X/Y. With no body it uses the CURRENT pose Z (jog down until
    the pen touches the workpiece, then press). With {"z": <mm>} it uses that
    value instead — e.g. the touch-off surface Z from the control_robot Z
    camera calibration (Z_SURFACE in config). The robot does not move."""
    if not robot.connected:
        return {"ok": False, "error": "not connected"}
    if not _grid_fully_marked():
        return {"ok": False, "error": "grid not fully marked"}
    robot.ensure_frame()
    _, _, cur_z, Rx, Ry, Rz = robot.get_pose()
    Z = cur_z if body.z is None else float(body.z)
    for i in range(state.grid_rows):
        for j in range(state.grid_cols):
            p = state.grid_points[i][j]
            p[2], p[3], p[4], p[5] = Z, Rx, Ry, Rz
    state.status = (f"grid Z set to {Z:.1f}mm "
                     f"({'current pose' if body.z is None else 'requested'})")
    return {"ok": True, "z": Z, "from_current_pose": body.z is None,
            "grid_points": state.grid_points}


@router.post("/grid/surfacez")
def api_grid_surfacez():
    """Estimate the workpiece surface Z from the LIVE depth reading and move
    the grid onto it — no jogging. Valid while the tool is squared to the
    surface (run Align first) so the camera looks straight down at it:
    surface_Z = pose_Z - depth + tip offset + safety gap. The robot does not
    move here; the next Send is what descends."""
    if not robot.connected or not cam._running:
        return {"ok": False, "error": "robot/camera not ready"}
    if not _grid_fully_marked():
        return {"ok": False, "error": "grid not fully marked"}
    depth = state.last_center_depth
    if not depth or depth <= 0:
        return {"ok": False,
                "error": "no depth reading yet — mark the object on the image first"}
    robot.ensure_frame()
    _, _, pose_z, Rx, Ry, Rz = robot.get_pose()
    surface_z = pose_z - depth + CAM_TIP_OFFSET_MM + DRAW_SURFACE_GAP_MM
    for i in range(state.grid_rows):
        for j in range(state.grid_cols):
            p = state.grid_points[i][j]
            p[2], p[3], p[4], p[5] = surface_z, Rx, Ry, Rz
    state.status = (f"grid Z -> measured surface {surface_z:.1f}mm "
                     f"(pose {pose_z:.1f} - depth {depth:.1f} + "
                     f"{CAM_TIP_OFFSET_MM:.1f} + {DRAW_SURFACE_GAP_MM:.1f})")
    return {"ok": True, "z": surface_z, "pose_z": pose_z, "depth": depth,
            "tip_offset": CAM_TIP_OFFSET_MM, "gap": DRAW_SURFACE_GAP_MM,
            "grid_points": state.grid_points}


@router.post("/grid/reset")
def api_grid_reset():
    for i in range(state.grid_rows):
        for j in range(state.grid_cols):
            state.grid_points[i][j] = None
    return {"ok": True}


class GridRestoreBody(BaseModel):
    rows: int
    cols: int
    points: list


@router.post("/grid/restore")
def api_grid_restore(body: GridRestoreBody):
    """Set the whole taught grid directly from poses (the same rows/cols/
    points shape /api/map/status reports back). The grid lives in memory, so
    every backend restart wipes a hand-taught grid — this puts one back
    without re-jogging every corner."""
    if not (2 <= body.rows <= DRAW_GRID_MAX_ROWS and 2 <= body.cols <= DRAW_GRID_MAX_COLS):
        return {"ok": False,
                "error": f"rows/cols must be 2..{DRAW_GRID_MAX_ROWS} x 2..{DRAW_GRID_MAX_COLS}"}
    if state.align_running or state.draw_running:
        return {"ok": False, "error": "robot busy (align or draw running)"}
    if not isinstance(body.points, list) or len(body.points) != body.rows:
        return {"ok": False, "error": f"points must be {body.rows} rows"}
    grid = []
    for row in body.points:
        if not isinstance(row, list) or len(row) != body.cols:
            return {"ok": False, "error": f"each row must have {body.cols} points"}
        out_row = []
        for p in row:
            if not isinstance(p, (list, tuple)) or len(p) != 6:
                return {"ok": False, "error": "each point must be [X,Y,Z,Rx,Ry,Rz]"}
            try:
                out_row.append([float(v) for v in p])
            except (TypeError, ValueError):
                return {"ok": False, "error": "non-numeric point value"}
        grid.append(out_row)
    state.grid_rows = body.rows
    state.grid_cols = body.cols
    state.grid_points = grid
    span = _grid_span_mm()
    state.status = f"grid restored {body.rows}x{body.cols} (span={span:.1f}mm)"
    return {"ok": True, "rows": body.rows, "cols": body.cols,
            "grid_points": grid, "span_mm": span}


def _log_grid_mapping(strokes):
    """Print where each stroke's canvas (u,v) lands in robot XYZ, plus the
    taught grid corners it interpolates between. The drawn stroke and the
    camera frame it was drawn over live in different coordinate spaces, so
    the only way to tell whether a click on screen lands on the intended
    physical grid cell is to read the numbers: a systematic offset means the
    camera<->canvas transform is wrong, while a mirrored/reordered result
    means row/col orientation is. Read-only — never moves the robot."""
    rows, cols = state.grid_rows, state.grid_cols
    log(f"  [Draw] mapping {len(strokes)} stroke(s) over {rows}x{cols} grid  "
        f"cam={cam.w}x{cam.h}")

    for i in range(rows):
        for j in range(cols):
            p = state.grid_points[i][j]
            if p is not None:
                log(f"  [Draw]   R{i+1}C{j+1} = "
                    f"({p[0]:.1f}, {p[1]:.1f}, {p[2]:.1f})")

    for si, s in enumerate(strokes):
        pts = s.get("points") or []
        if not pts:
            continue
        u0, v0 = pts[0]
        u1, v1 = pts[-1]
        first = grid_pose(u0, v0, state.grid_points, rows, cols)
        last = grid_pose(u1, v1, state.grid_points, rows, cols)
        log(f"  [Draw]   stroke {si} ({s.get('tool')}, {len(pts)} pts): "
            f"uv({u0:.3f},{v0:.3f})->({u1:.3f},{v1:.3f})  "
            f"XY({first[0]:.1f},{first[1]:.1f})->({last[0]:.1f},{last[1]:.1f})  "
            f"Z={first[2]:.1f}")


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
    span_mm = _grid_span_mm()
    if span_mm < DRAW_MIN_GRID_SPAN_MM:
        return {"ok": False,
                "error": f"grid has no size (span={span_mm:.1f}mm) — "
                         f"jog to each corner before marking"}
    if state.align_running or state.draw_running:
        return {"ok": False, "error": "already running"}

    _log_grid_mapping(strokes)
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
        "z_surface": Z_SURFACE,
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
        "sequence_running": sequence_running,
        "sequence_index": sequence_index,
        "sequence_total": sequence_total,
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