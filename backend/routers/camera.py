import time
import struct
from typing import Optional
from fastapi import APIRouter, Response, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import threading
import cv2
import numpy as np

from routers.mapcontrol import cam, state, _mjpeg_generator, _STREAM_HEADERS, _colorize_depth
from maps_point.camera import list_devices, Camera
from maps_point.render import draw_overlay

router = APIRouter()

SCAN_TIMEOUT_S = 6.0


class CameraModeBody(BaseModel):
    mode: str  # "rgb", "gray", or "depth"


class CameraSelectBody(BaseModel):
    serial: str = ""


# ── Secondary Camera Singleton ───────────────────────────────────────────────
cam2: Optional[Camera] = None
cam2_lock = threading.Lock()
_cam2_start_lock = threading.Lock()
_cam2_last_active = 0.0


def get_cam2() -> Camera:
    global cam2
    with cam2_lock:
        if cam2 is None:
            cam2 = Camera()
        return cam2


def _cam2_pick_serial(target_serial: Optional[str] = None) -> Optional[str]:
    """Resolve which device serial CAM2 should use (explicit target, else the
    first enumerated device that is not CAM1's serial)."""
    devices = getattr(state, "camera_devices", [])
    if not devices:
        return None
    if target_serial:
        dev = next((d for d in devices if d.get("serial") == target_serial), None)
    else:
        dev = next((d for d in devices
                    if d.get("serial") and d.get("serial") != cam.serial), None)
    return dev["serial"] if dev else None


def start_cam2_once(target_serial: Optional[str] = None) -> Optional[Camera]:
    """Start CAM2 exactly like CAM1: one pipeline, started once, run forever.

    Unlike the old ensure_cam2_running() this never stops/restarts the pipeline
    while it is already running — a repeated stop()+start() here was racing the
    USB device with CAM1's pipeline and left both cameras dead with
    "Device or resource busy". If CAM2 is running it is returned as-is; the
    capture thread's own _reopen_pipeline() handles USB drops.

    NOTE: a freshly constructed Camera() inherits CAM_SERIAL (= CAM1's serial),
    so c2.serial is NOT trustworthy until it has been explicitly assigned. Any
    serial equal to CAM1's is discarded and the *other* enumerated device is
    used instead — otherwise both pipelines fight over the same D455.
    """
    global _cam2_last_active
    c2 = get_cam2()
    if c2._running:
        _cam2_last_active = time.time()
        return c2
    with _cam2_start_lock:
        if c2._running:
            _cam2_last_active = time.time()
            return c2
        serial = c2.serial
        if not serial or serial == cam.serial:
            serial = _cam2_pick_serial(target_serial)
        if not serial or serial == cam.serial:
            return None
        try:
            c2.set_serial(serial)
            print(f"[Cam2] starting serial={serial}", flush=True)
            c2.start()
        except Exception as e:
            print(f"[Cam2] Start failed: {e}", flush=True)
            return None
        _cam2_last_active = time.time()
        print(f"[Cam2] running={c2._running}", flush=True)
        return c2 if c2._running else None


def ensure_cam2_running(target_serial: Optional[str] = None) -> Optional[Camera]:
    """Backwards-compatible wrapper: return CAM2 if running, else start once."""
    c2 = get_cam2()
    if c2._running:
        global _cam2_last_active
        _cam2_last_active = time.time()
        return c2
    return start_cam2_once(target_serial)


def _cam2_transform(cf, df, mode: Optional[str]):
    """Apply display mode to a CAM2 frame (rgb/gray/depth), same modes as CAM1.
    Works on copies only — never mutates the shared depth/color buffers."""
    eff = (mode or "rgb").lower()
    if eff == "depth" and df is not None:
        return _colorize_depth(df)
    if eff == "gray":
        gray = cv2.cvtColor(cf, cv2.COLOR_BGR2GRAY)
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    return cf


_CAM2_ENC_LOCK = threading.Lock()
_CAM2_ENC_CACHE: dict = {}
_CAM2_ENC_CACHE_MAX = 4


def _cam2_encode(cf, df, mode: Optional[str], count: int):
    """Encode a CAM2 frame ONCE per (frame, mode) and share the bytes across
    every viewer — mirrors mapcontrol._encode_frame. Without this, each CAM2
    client ran its own colorize + JPEG pass, so N viewers cost N× CPU."""
    key = (count, (mode or "rgb").lower())
    hit = _CAM2_ENC_CACHE.get(key)
    if hit is not None:
        return hit
    with _CAM2_ENC_LOCK:
        hit = _CAM2_ENC_CACHE.get(key)
        if hit is not None:
            return hit
        ok, buf = cv2.imencode(".jpg", _cam2_transform(cf, df, mode),
                               [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            return None
        payload = buf.tobytes()
        if len(_CAM2_ENC_CACHE) >= _CAM2_ENC_CACHE_MAX:
            _CAM2_ENC_CACHE.clear()
        _CAM2_ENC_CACHE[key] = payload
        return payload


def _mjpeg_generator_cam2(target_serial: Optional[str] = None, mode: Optional[str] = None):
    """CAM2 MJPEG generator — same pacing as CAM1 (_mjpeg_generator).

    CAM2 now runs as a peer of CAM1 (started once at boot, never restarted by
    a viewer), so it gets the same uncapped "yield the instant a new frame
    exists" loop. The old 15fps throttle only added latency — every displayed
    frame was one to two frames behind the live scene.
    """
    global _cam2_last_active
    c2 = ensure_cam2_running(target_serial)
    if not c2 or not c2._running:
        h, w = 360, 640
        placeholder = np.zeros((h, w, 3), dtype=np.uint8)
        placeholder[:] = (15, 20, 28)
        cv2.putText(placeholder, "Camera 2: Initializing...", (w // 2 - 140, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (180, 180, 180), 2, cv2.LINE_AA)
        ok, buf = cv2.imencode(".jpg", placeholder, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if ok:
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")
        for _ in range(3):
            time.sleep(1.0)
            c2 = ensure_cam2_running(target_serial)
            if c2 and c2._running:
                break
        if not c2 or not c2._running:
            return

    last_count = -1
    while c2 and c2._running:
        _cam2_last_active = time.time()
        cf, df = c2.get_latest_frames_ref()
        if cf is None:
            time.sleep(0.01)
            continue

        count = c2._frame_count
        if count == last_count:
            time.sleep(0.002)
            continue
        last_count = count

        payload = _cam2_encode(cf, df, mode, count)
        if payload is None:
            continue
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + payload + b"\r\n")


@router.get("/mode")
def get_camera_mode():
    """Get current camera display mode (rgb, gray, or depth)."""
    return {"mode": getattr(state, "camera_mode", "rgb")}


@router.post("/mode")
def set_camera_mode(body: CameraModeBody):
    """Set camera display mode (rgb, gray, or depth)."""
    m = body.mode.lower()
    if m not in ("rgb", "gray", "depth"):
        return {"ok": False, "error": f"Invalid mode '{body.mode}'. Expected 'rgb', 'gray', or 'depth'"}
    state.camera_mode = m
    return {"ok": True, "mode": state.camera_mode}


@router.get("/mode2")
def get_camera_mode2():
    """Get current CAM2 display mode (rgb, gray, or depth)."""
    return {"mode": getattr(state, "camera2_mode", "rgb")}


@router.post("/mode2")
def set_camera_mode2(body: CameraModeBody):
    """Set CAM2 display mode (rgb, gray, or depth)."""
    m = body.mode.lower()
    if m not in ("rgb", "gray", "depth"):
        return {"ok": False, "error": f"Invalid mode '{body.mode}'. Expected 'rgb', 'gray', or 'depth'"}
    state.camera2_mode = m
    return {"ok": True, "mode": state.camera2_mode}


@router.post("/mode/toggle")
def toggle_camera_mode():
    """Cycle between rgb, gray, and depth mode."""
    modes = ["rgb", "gray", "depth"]
    current = getattr(state, "camera_mode", "rgb")
    next_idx = (modes.index(current) + 1) % len(modes) if current in modes else 0
    state.camera_mode = modes[next_idx]
    return {"ok": True, "mode": state.camera_mode}


@router.get("/devices")
def get_camera_devices():
    """Cached RealSense device list plus currently selected serial and secondary serial."""
    devices = getattr(state, "camera_devices", [])
    c2 = cam2
    c2_serial = c2.serial if c2 else None
    c2_running = c2._running if c2 else False
    other = next((d for d in devices if d.get("serial") and d.get("serial") != cam.serial), None)

    return {
        "devices": devices,
        "selected": cam.serial,
        "running": cam._running,
        "secondary_selected": c2_serial or (other["serial"] if other else None),
        "secondary_running": c2_running,
        "has_secondary": bool(other),
        "secondary_device": other,
    }


@router.post("/scan")
def scan_camera_devices():
    """Enumerate RealSense devices WITHOUT touching the running pipeline."""
    result: dict = {}

    def _enumerate():
        try:
            result["devices"] = list_devices()
        except Exception as e:
            result["error"] = str(e)

    worker = threading.Thread(target=_enumerate, daemon=True)
    worker.start()
    worker.join(SCAN_TIMEOUT_S)

    if worker.is_alive():
        devs = getattr(state, "camera_devices", [])
        other = next((d for d in devs if d.get("serial") and d.get("serial") != cam.serial), None)
        return {
            "ok": False,
            "error": "scan timed out (camera busy) — showing cached list",
            "devices": devs,
            "selected": cam.serial,
            "running": cam._running,
            "has_secondary": bool(other),
            "secondary_device": other,
        }

    devices = result.get("devices") or []
    if devices:
        state.camera_devices = devices
    devs = getattr(state, "camera_devices", [])
    other = next((d for d in devs if d.get("serial") and d.get("serial") != cam.serial), None)
    return {
        "ok": True,
        "devices": devs,
        "selected": cam.serial,
        "running": cam._running,
        "has_secondary": bool(other),
        "secondary_device": other,
    }


@router.post("/select")
def select_camera(body: CameraSelectBody):
    """Switch to a specific RealSense by serial. Empty string = first device."""
    if state.align_running or state.draw_running:
        return {"ok": False,
                "error": "Camera switch blocked while align/draw is running — stop it first"}
    c2 = get_cam2()
    if c2 and c2._running and c2.serial == body.serial:
        c2.stop()

    old_primary = cam.serial
    cam.stop()
    cam.set_serial(body.serial)
    ok = cam.start()

    if ok and c2 and old_primary and old_primary != body.serial:
        devices = getattr(state, "camera_devices", [])
        if any(d.get("serial") == old_primary for d in devices):
            c2.set_serial(old_primary)
            c2.start()

    return {"ok": ok, "selected": cam.serial, "running": cam._running}


@router.post("/swap")
def swap_cameras():
    """Swap primary and secondary cameras."""
    if state.align_running or state.draw_running:
        return {"ok": False,
                "error": "Camera swap blocked while align/draw is running — stop it first"}
    devices = getattr(state, "camera_devices", [])
    if len(devices) < 2:
        return {"ok": False, "error": "Need at least 2 cameras to swap"}

    old_primary = cam.serial
    c2 = get_cam2()
    old_secondary = (
        c2.serial if (c2 and c2.serial) else next((d["serial"] for d in devices if d.get("serial") != old_primary), None)
    )

    if not old_secondary or old_secondary == old_primary:
        return {"ok": False, "error": "No secondary camera found to swap with"}

    if c2:
        c2.stop()
    cam.stop()

    cam.set_serial(old_secondary)
    ok1 = cam.start()

    if c2:
        c2.set_serial(old_primary)
        ok2 = c2.start()
    else:
        ok2 = False

    return {
        "ok": ok1,
        "selected": cam.serial,
        "secondary_selected": c2.serial if c2 else None,
        "running": cam._running,
        "secondary_running": c2._running if c2 else False,
    }


@router.get("/stream")
def camera_stream(mode: Optional[str] = None):
    """Stream MJPEG video feed (supports optional ?mode=rgb or ?mode=gray)."""
    return StreamingResponse(
        _mjpeg_generator(mode=mode),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=_STREAM_HEADERS,
    )


@router.get("/stream2")
def camera_stream_secondary(serial: Optional[str] = None, mode: Optional[str] = None):
    """Stream MJPEG video feed for secondary camera (optional ?mode=rgb|gray|depth)."""
    if mode:
        m = mode.lower()
        if m in ("rgb", "gray", "depth"):
            state.camera2_mode = m
    return StreamingResponse(
        _mjpeg_generator_cam2(target_serial=serial, mode=mode),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=_STREAM_HEADERS,
    )


@router.get("/pointcloud2")
def camera_pointcloud2(serial: Optional[str] = None):
    """Secondary camera's SDK colored cloud, same binary layout as
    /api/map/pointcloud (uint32 N + int16 mm xyz + uint8 rgb)."""
    c2 = ensure_cam2_running(target_serial=serial)
    if not c2 or not c2._running:
        return Response(status_code=503)
    pos, col = c2.get_latest_pointcloud()
    if pos is None or pos.shape[0] == 0:
        return Response(status_code=503)
    mm = np.clip(pos * 1000.0, -32767.0, 32767.0).astype("<i2")
    rgb = np.ascontiguousarray(col, dtype=np.uint8)
    body = struct.pack("<I", mm.shape[0]) + mm.tobytes() + rgb.tobytes()
    return Response(content=body, media_type="application/octet-stream",
                    headers=_STREAM_HEADERS)


@router.get("/depth_grid2")
def camera_depth_grid2(serial: Optional[str] = None):
    c2 = ensure_cam2_running(target_serial=serial)
    if not c2 or not c2._running:
        return Response(status_code=503)
    cf, df = c2.get_latest_frames_ref()
    if df is None:
        return Response(status_code=503)
    d = cv2.resize(df, (212, 120), interpolation=cv2.INTER_NEAREST)
    d = np.ascontiguousarray(d, dtype="<u2")
    hdr = struct.pack("<HH", 212, 120)
    return Response(content=hdr + d.tobytes(), media_type="application/octet-stream",
                    headers=_STREAM_HEADERS)


@router.get("/snapshot")
def camera_snapshot(mode: Optional[str] = None, with_overlay: bool = True):
    """Return a single JPEG frame from the camera."""
    if not cam._running:
        return Response(content="Camera is not running", status_code=503, media_type="text/plain")

    color_frame = cam.get_latest_color(max_wait=1.0)
    if color_frame is None:
        return Response(content="No camera frame available", status_code=503, media_type="text/plain")

    frame = color_frame.copy()
    effective_mode = (mode or getattr(state, "camera_mode", "rgb")).lower()
    if effective_mode == "gray":
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        frame = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    if with_overlay:
        frame = draw_overlay(frame, state)

    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        return Response(content="Failed to encode image", status_code=500, media_type="text/plain")

    return Response(content=buf.tobytes(), media_type="image/jpeg")


@router.get("/snapshot2")
def camera_snapshot_secondary(serial: Optional[str] = None):
    """Return a single JPEG frame from the secondary camera."""
    c2 = ensure_cam2_running(target_serial=serial)
    if not c2 or not c2._running:
        return Response(content="Secondary camera is not running", status_code=503, media_type="text/plain")
    cf = c2.get_latest_color(max_wait=1.0)
    if cf is None:
        return Response(content="No frame available", status_code=503, media_type="text/plain")
    ok, buf = cv2.imencode(".jpg", cf, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        return Response(content="Encode failed", status_code=500, media_type="text/plain")
    return Response(content=buf.tobytes(), media_type="image/jpeg")
