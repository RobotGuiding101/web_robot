"""device_events.py — best-effort DeviceLog writer.

Called from both sync FastAPI handlers (threadpool, no running loop) and async
ones, so each event spawns a short-lived daemon thread that owns its own
asyncio loop + engine + connection. A long-lived worker thread was tried first
but died permanently after the first DB error (the DB was missing the `detail`
column), and a Thread can only be started once, so every later event was
silently dropped. A fresh engine per event costs ~10-30 ms but is immune to
that and to cross-event-loop pool issues; events are low-frequency.
"""

import asyncio
import os
import threading

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from models import DeviceLog

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings",
)
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)


def _run(coro_factory):
    def _target():
        try:
            asyncio.run(coro_factory())
        except Exception as e:
            print(f"[device_events] {type(e).__name__}: {e}", flush=True)

    threading.Thread(target=_target, daemon=True).start()


def log_event(user_id: str, device: str, state: str, detail: str = "") -> None:
    """Queue one DeviceLog row. Never blocks and never raises."""
    if not user_id:
        return

    async def _write():
        engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
        session = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with session() as s:
                s.add(DeviceLog(user_id=user_id, device=device,
                                state=state, detail=detail))
                await s.commit()
        finally:
            await engine.dispose()

    _run(_write)


def get_recent(limit: int = 50) -> list[dict]:
    """Latest logs, synchronously, for audit/admin views."""
    result: list[dict] = []

    async def _read():
        engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
        session = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with session() as s:
                rows = await s.execute(
                    select(DeviceLog).order_by(desc(DeviceLog.created_at)).limit(limit))
                for l in rows.scalars().all():
                    result.append({
                        "device": l.device,
                        "state": l.state,
                        "detail": l.detail,
                        "time": l.created_at.isoformat() if l.created_at else None,
                    })
        finally:
            await engine.dispose()

    thread = threading.Thread(target=lambda: asyncio.run(_read()), daemon=True)
    thread.start()
    thread.join(timeout=8)
    return result
