from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()


@router.get("/stream")
def camera_stream():
    # TODO: Stream MJPEG frames from OpenCV camera capture
    # Example:
    #   return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")
    return {"message": "Camera stream not yet implemented"}


@router.get("/snapshot")
def camera_snapshot():
    # TODO: Return a single JPEG frame from the camera
    return {"message": "Snapshot not yet implemented"}
