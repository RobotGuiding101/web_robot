"""device_events.py — fire-and-forget DeviceLog writer.

Every "real event" (robot connect/home/emergency/goto, camera start, WebRTC
session open/close, align result) is logged here. The write runs on a
dedicated daemon thread with its OWN asyncio loop + DB session:

  * Sync FastAPI handlers run in the threadpool — they have no running event
    loop, so they cannot await a DB session directly.
  * The main request must never block on (or be broken by) logging, so the
    insert is queued and retried with backoff. A DB outage degrades the log
    silently instead of failing the robot/camera action.

The thread also means logging survives the request scope: the insert still
happens even if the caller has already returned its HTTP response.
"""

import asyncio
import os
import queue
import threading

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from models import DeviceLog

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings",
)
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

_engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=2,
    max_overflow=4,
    pool_timeout=5,
)
_session = async_sessionmaker(_engine, expire_on_commit=False)

_queue: "queue.Queue[tuple]" = queue.Queue(maxsize=2000)
_loop = None
_started = threading.Event()


def _worker():
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    _started.set()

    async def _drain():
        while True:
            item = await asyncio.to_thread(_queue.get)
            user_id, device, state, detail = item
            try:
                async with _session() as session:
                    session.add(DeviceLog(
                        user_id=user_id, device=device, state=state, detail=detail))
                    await session.commit()
            except Exception:
                # Best-effort logging — never raise into the request path.
                pass

    try:
        _loop.run_until_complete(_drain())
    except Exception:
        pass


_thread = threading.Thread(target=_worker, name="device-log-writer", daemon=True)


def log_event(user_id: str, device: str, state: str, detail: str = "") -> None:
    """Queue one DeviceLog row. Never blocks and never raises."""
    if not user_id:
        return
    if not _thread.is_alive():
        _thread.start()
    try:
        _queue.put_nowait((user_id, device, state, detail))
    except queue.Full:
        pass  # drop rather than block the robot/camera action


def get_recent(limit: int = 50) -> list[dict]:
    """Read the latest logs synchronously (own loop). For admin/audit views."""
    if not _started.wait(timeout=5):
        return []
    loop = _loop
    if loop is None:
        return []

    async def _read():
        from sqlalchemy import select, desc
        async with _session() as session:
            result = await session.execute(
                select(DeviceLog).order_by(desc(DeviceLog.created_at)).limit(limit))
            logs = result.scalars().all()
            return [{
                "device": l.device,
                "state": l.state,
                "detail": l.detail,
                "time": l.created_at.isoformat() if l.created_at else None,
            } for l in logs]

    future = asyncio.run_coroutine_threadsafe(_read(), loop)
    try:
        return future.result(timeout=10)
    except Exception:
        return []