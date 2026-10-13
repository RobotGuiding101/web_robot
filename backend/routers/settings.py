"""routers/settings.py — GET/PUT user settings (key-value store in PostgreSQL)."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from maps_point.config import HOME_X, HOME_Y, HOME_Z, HOME_RX, HOME_RY, HOME_RZ
from models import User, UserSetting
from routers.auth import get_current_user

router = APIRouter(prefix="/api/settings", tags=["Settings"])


# ── schemas ──────────────────────────────────────────────────────────────────
class SettingItem(BaseModel):
    key: str
    value: str


class SettingsBulk(BaseModel):
    settings: list[SettingItem]


class SettingUpdate(BaseModel):
    key: str
    value: str


# ── defaults (used when user has no saved value) ────────────────────────────
DEFAULTS: dict[str, str] = {
    "robot_ip": "192.168.10.110",
    "move_speed": "10",
    "home_x": str(HOME_X),
    "home_y": str(HOME_Y),
    "home_z": str(HOME_Z),
    "home_rx": str(HOME_RX),
    "home_ry": str(HOME_RY),
    "home_rz": str(HOME_RZ),
    "cam_serial": "",
    "cam_serial2": "",
    "cam_devices": "[]",
    "depth_roi": "15",
    "min_depth_mm": "330.0",
    "sidebar_speed": "50",
    "theme": "dark",
}


# ── routes ───────────────────────────────────────────────────────────────────
@router.get("")
async def get_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all settings for the current user, falling back to defaults."""
    result = await db.execute(
        select(UserSetting).where(UserSetting.user_id == user.id)
    )
    saved = {s.key: s.value for s in result.scalars().all()}

    return {**DEFAULTS, **saved}


@router.put("")
async def put_settings(
    body: SettingsBulk,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bulk-update settings (upsert each key)."""
    for item in body.settings:
        result = await db.execute(
            select(UserSetting).where(
                UserSetting.user_id == user.id,
                UserSetting.key == item.key,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.value = item.value
        else:
            db.add(UserSetting(user_id=user.id, key=item.key, value=item.value))
    await db.commit()
    return {"ok": True, "updated": len(body.settings)}


@router.put("/{key}")
async def put_single_setting(
    key: str,
    body: SettingUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a single setting by key."""
    if body.key != key:
        raise HTTPException(400, "Key in path and body must match")

    result = await db.execute(
        select(UserSetting).where(
            UserSetting.user_id == user.id,
            UserSetting.key == key,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.value = body.value
    else:
        db.add(UserSetting(user_id=user.id, key=key, value=body.value))
    await db.commit()
    return {"ok": True, "key": key, "value": body.value}
