from typing import Optional
from fastapi import APIRouter, Response, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import cv2
import numpy as np

from routers.mapcontrol import cam, state, _mjpeg_generator, _STREAM_HEADERS
from maps_point.camera import list_devices
from maps_point.render import draw_overlay

router = APIRouter()


class CameraModeBody(BaseModel):
    mode: str  # "rgb", "gray", or "depth"


class CameraSelectBody(BaseModel):
    serial: str = ""


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
    """Cached RealSense device list plus the currently selected serial."""
    return {
        "devices": getattr(state, "camera_devices", []),
        "selected": cam.serial,
        "running": cam._running,
    }


@router.post("/scan")
def scan_camera_devices():
    """Enumerate RealSense devices. Listed serials are librealsense's own
    serial numbers (the USB iSerial differs, so it must not be used for
    enable_device()). Falls back to stopping the pipeline and retrying if
    enumeration fails while it is running."""
    devices = list_devices()
    if not devices and cam._running:
        cam.stop()
        devices = list_devices()
        cam.start()
    state.camera_devices = devices
    return {
        "ok": True,
        "devices": devices,
        "selected": cam.serial,
        "running": cam._running,
    }


@router.post("/select")
def select_camera(body: CameraSelectBody):
    """Switch to a specific RealSense by serial. Empty string = first device."""
    cam.stop()
    cam.set_serial(body.serial)
    ok = cam.start()
    return {"ok": ok, "selected": cam.serial, "running": cam._running}


@router.get("/stream")
def camera_stream(mode: Optional[str] = None):
    """Stream MJPEG video feed (supports optional ?mode=rgb or ?mode=gray)."""
    return StreamingResponse(
        _mjpeg_generator(mode=mode),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=_STREAM_HEADERS,
    )


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

