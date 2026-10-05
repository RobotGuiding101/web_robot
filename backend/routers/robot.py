"""routers/robot.py — emergency stop only.

The real motion/status endpoints live in routers/mapcontrol.py (/api/map/*).
This router used to expose placeholder /move, /draw and /status handlers that
returned hardcoded zeroes and were never called by the frontend; only
/emergency-stop is used (top bar + dashboard), so the rest was removed.
"""
from fastapi import APIRouter

router = APIRouter()


@router.post("/emergency-stop")
def emergency_stop():
    from routers.mapcontrol import robot, sequence_stop, state
    sequence_stop.set()
    state.align_stop.set()
    state.draw_stop.set()
    state.align_running = False
    state.draw_running = False
    if robot.connected:
        robot.emergency_stop()
    return {"status": "emergency_stop_triggered", "ok": True}
