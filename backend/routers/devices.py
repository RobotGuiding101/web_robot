"""routers/devices.py — Blynk relay control + state logging + ping check."""
import asyncio
import os
import urllib.request
import subprocess
from fastapi import APIRouter, Depends
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, DeviceLog
from routers.auth import get_current_user

router = APIRouter(prefix="/api/devices", tags=["Devices"])

BLYNK_TOKEN = os.environ.get("BLYNK_TOKEN", "")
BLYNK_BASE = "https://blynk.cloud/external/api/update"
ROBOT_IP = "192.168.10.110"


def _blynk_set(pin: str, value: int):
    """Blocking Blynk call — always invoke through a thread executor."""
    if not BLYNK_TOKEN:
        return False
    url = f"{BLYNK_BASE}?token={BLYNK_TOKEN}&{pin}={value}"
    try:
        req = urllib.request.Request(url)
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception:
        return False


def _ping_host(ip: str, timeout: int = 2) -> dict:
    """Single ping attempt, returns reachable + avg latency."""
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", str(timeout), ip],
            capture_output=True, text=True, timeout=timeout + 2
        )
        avg_ms = None
        for line in result.stdout.split("\n"):
            if "time=" in line:
                part = line.split("time=")[-1].strip().split()[0]
                avg_ms = float(part)
        return {"reachable": result.returncode == 0, "avg_ms": avg_ms}
    except Exception:
        return {"reachable": False, "avg_ms": None}





@router.post("/relay/toggle")
async def toggle_relay(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle relay V1 on/off, log to DB, return immediately."""
    result = await db.execute(
        select(DeviceLog)
        .where(DeviceLog.user_id == user.id, DeviceLog.device == "relay_v1")
        .order_by(desc(DeviceLog.created_at))
        .limit(1)
    )
    last = result.scalar_one_or_none()
    current_state = last.state if last else "off"
    new_state = "on" if current_state == "off" else "off"
    blynk_value = 1 if new_state == "on" else 0

    # Performance-critical: release the pooled connection BEFORE the blocking
    # Blynk call. Holding it across that HTTP request exhausted the 5+10 pool.
    await db.commit()

    ok = await asyncio.get_running_loop().run_in_executor(None, _blynk_set, "V1", blynk_value)

    log = DeviceLog(user_id=user.id, device="relay_v1", state=new_state)
    db.add(log)
    await db.commit()

    return {"ok": True, "state": new_state, "blynk_sent": ok}


@router.get("/relay/state")
async def get_relay_state(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current relay state."""
    result = await db.execute(
        select(DeviceLog)
        .where(DeviceLog.user_id == user.id, DeviceLog.device == "relay_v1")
        .order_by(desc(DeviceLog.created_at))
        .limit(1)
    )
    last = result.scalar_one_or_none()
    return {"state": last.state if last else "off"}


@router.get("/relay/history")
async def get_relay_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get relay toggle history."""
    result = await db.execute(
        select(DeviceLog)
        .where(DeviceLog.user_id == user.id, DeviceLog.device == "relay_v1")
        .order_by(desc(DeviceLog.created_at))
        .limit(50)
    )
    logs = result.scalars().all()
    return {"history": [{"state": l.state, "time": l.created_at.isoformat()} for l in logs]}


@router.get("/events")
async def get_events(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    device: str = "",
    username: str = "",
    search: str = "",
    limit: int = 100,
    offset: int = 0,
):
    """Activity log with the acting user — "who did what" (robot / camera /
    align / estop / relay). Newest first; filter by device, username, or a
    free-text match on `detail`; page with limit + offset."""
    stmt = (
        select(DeviceLog, User.username)
        .join(User, DeviceLog.user_id == User.id, isouter=True)
    )
    if device:
        stmt = stmt.where(DeviceLog.device == device)
    if username:
        stmt = stmt.where(User.username == username)
    if search:
        stmt = stmt.where(DeviceLog.detail.ilike(f"%{search}%"))
    stmt = (
        stmt.order_by(desc(DeviceLog.created_at))
        .limit(max(1, min(limit, 500)))
        .offset(max(0, offset))
    )
    rows = (await db.execute(stmt)).all()
    return {
        "events": [
            {
                "id": log.id,
                "time": log.created_at.isoformat() if log.created_at else None,
                "user": uname or log.user_id,
                "device": log.device,
                "action": log.state,
                "detail": log.detail,
            }
            for log, uname in rows
        ]
    }


@router.post("/events/prune")
async def prune_events(
    device: str = "",
    keep: int = 100,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete all but the newest `keep` rows (optionally for one device).

    device_logs only ever grows; the auto-align loop in particular can write
    hundreds of near-identical rows. This trims the table on demand."""
    from sqlalchemy import delete
    keep = max(1, min(int(keep), 5000))
    sub = select(DeviceLog.id).where(DeviceLog.user_id == user.id)
    if device:
        sub = sub.where(DeviceLog.device == device)
    sub = sub.order_by(desc(DeviceLog.created_at)).limit(keep)
    keep_ids = list((await db.execute(sub)).scalars().all())
    stmt = delete(DeviceLog).where(DeviceLog.user_id == user.id)
    if keep_ids:
        stmt = stmt.where(DeviceLog.id.notin_(keep_ids))
    if device:
        stmt = stmt.where(DeviceLog.device == device)
    res = await db.execute(stmt)
    await db.commit()
    return {"ok": True, "deleted": int(res.rowcount or 0)}


@router.get("/ping")
async def ping_robot():
    """Quick ping check for robot at 192.168.10.110."""
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, _ping_host, ROBOT_IP)
    return result
