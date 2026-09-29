from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal

router = APIRouter()


class MoveRequest(BaseModel):
    axis: str          # e.g. "X", "Y", "Z", "J1", etc.
    direction: Literal["+", "-"]
    step: float        # step value: 0.1 | 1 | 5 | 10


class DrawRequest(BaseModel):
    # TODO: Define drawing parameters
    pass


@router.post("/move")
def move_robot(body: MoveRequest):
    # TODO: Send jog command to Dobot SDK / serial port
    return {"status": "ok", "axis": body.axis, "direction": body.direction, "step": body.step}


@router.post("/emergency-stop")
def emergency_stop():
    # TODO: Send emergency stop signal to robot
    return {"status": "emergency_stop_triggered"}


@router.post("/draw")
def start_drawing(body: DrawRequest):
    # TODO: Trigger drawing mode on robot arm
    return {"status": "drawing_started"}


@router.get("/status")
def get_status():
    # TODO: Return real-time robot position / status from SDK
    return {
        "connected": False,
        "position": {"x": 0.0, "y": 0.0, "z": 0.0},
        "joints": {"j1": 0.0, "j2": 0.0, "j3": 0.0, "j4": 0.0, "j5": 0.0, "j6": 0.0},
    }
