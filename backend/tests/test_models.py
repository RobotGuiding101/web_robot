"""Unit tests for models.py — ORM defaults + constraints on an in-memory DB."""
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from models import Base, DeviceLog, User, UserSetting


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


async def test_user_defaults_generate_uuid_and_timestamp(session):
    user = User(username="alice", password_hash="hash")
    session.add(user)
    await session.commit()
    assert user.id and len(user.id) == 36
    assert user.created_at is not None


async def test_username_must_be_unique(session):
    session.add(User(username="dup", password_hash="a"))
    await session.commit()
    session.add(User(username="dup", password_hash="b"))
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()


async def test_user_setting_unique_per_user_and_key(session):
    user = User(username="carol", password_hash="h")
    session.add(user)
    await session.commit()

    session.add(UserSetting(user_id=user.id, key="theme", value="dark"))
    await session.commit()

    session.add(UserSetting(user_id=user.id, key="theme", value="light"))
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()


async def test_settings_relationship_round_trip(session):
    user = User(username="dave", password_hash="h")
    user.settings.append(UserSetting(key="units", value="mm"))
    session.add(user)
    await session.commit()

    count = await session.scalar(
        select(func.count()).select_from(UserSetting).where(UserSetting.user_id == user.id)
    )
    assert count == 1
    assert user.settings[0].key == "units"


async def test_device_log_persists(session):
    user = User(username="erin", password_hash="h")
    session.add(user)
    await session.commit()

    session.add(DeviceLog(user_id=user.id, device="camera", state="on"))
    await session.commit()

    count = await session.scalar(select(func.count()).select_from(DeviceLog))
    assert count == 1
