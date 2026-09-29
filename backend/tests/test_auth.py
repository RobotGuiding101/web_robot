"""Unit tests for routers/auth.py — JWT + bcrypt + login/register/me endpoints.

The real Postgres session is replaced with an in-memory aiosqlite database via
FastAPI's dependency_overrides, so no DB server is required.
"""
from datetime import datetime, timezone

import httpx
import pytest
from fastapi import FastAPI
from jose import jwt
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import routers.auth as auth
from database import get_db
from models import Base, User


@pytest.fixture
async def app_and_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    app = FastAPI()
    app.include_router(auth.router, prefix="/api/auth")

    async def override_get_db():
        async with factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    yield app, factory
    await engine.dispose()


@pytest.fixture
async def client(app_and_session):
    app, _ = app_and_session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _seed_user(factory, username, password):
    async with factory() as s:
        s.add(User(username=username, password_hash=auth.pwd_ctx.hash(password)))
        await s.commit()


async def _login(client, username, password):
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    return r.json()["access_token"]


# ── helpers ──────────────────────────────────────────────────────────────────
def test_create_token_round_trip():
    token = auth._create_token("uid-1", "neo")
    payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
    assert payload["sub"] == "uid-1"
    assert payload["username"] == "neo"
    assert payload["exp"] > datetime.now(timezone.utc).timestamp()


def test_password_hash_and_verify():
    hashed = auth.pwd_ctx.hash("s3cret")
    assert hashed != "s3cret"
    assert auth.pwd_ctx.verify("s3cret", hashed)
    assert not auth.pwd_ctx.verify("wrong", hashed)


# ── login ────────────────────────────────────────────────────────────────────
async def test_login_success_returns_bearer_token(client, app_and_session):
    _, factory = app_and_session
    await _seed_user(factory, "neo", "pw123")

    r = await client.post("/api/auth/login", json={"username": "neo", "password": "pw123"})
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "neo"
    assert body["token_type"] == "bearer"
    payload = jwt.decode(body["access_token"], auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
    assert payload["username"] == "neo"


async def test_login_wrong_password_is_401(client, app_and_session):
    _, factory = app_and_session
    await _seed_user(factory, "neo", "pw123")
    r = await client.post("/api/auth/login", json={"username": "neo", "password": "nope"})
    assert r.status_code == 401


async def test_login_unknown_user_is_401(client):
    r = await client.post("/api/auth/login", json={"username": "ghost", "password": "x"})
    assert r.status_code == 401


# ── /me ──────────────────────────────────────────────────────────────────────
async def test_me_without_token_is_401(client):
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_me_with_garbage_token_is_401(client):
    r = await client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


async def test_me_returns_current_user(client, app_and_session):
    _, factory = app_and_session
    await _seed_user(factory, "trinity", "pw123")
    token = await _login(client, "trinity", "pw123")
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "trinity"


async def test_valid_token_for_deleted_user_is_401(client, app_and_session):
    token = auth._create_token("ghost-id", "ghost")
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


# ── register ─────────────────────────────────────────────────────────────────
async def test_register_requires_authentication(client):
    r = await client.post("/api/auth/register", json={"username": "new", "password": "pw12"})
    assert r.status_code == 401


async def test_register_validation_and_success(client, app_and_session):
    _, factory = app_and_session
    await _seed_user(factory, "admin", "adminpw")
    token = await _login(client, "admin", "adminpw")
    h = {"Authorization": f"Bearer {token}"}

    short_name = await client.post(
        "/api/auth/register", json={"username": "a", "password": "pw12"}, headers=h)
    assert short_name.status_code == 400

    short_pw = await client.post(
        "/api/auth/register", json={"username": "bobby", "password": "x"}, headers=h)
    assert short_pw.status_code == 400

    dupe = await client.post(
        "/api/auth/register", json={"username": "admin", "password": "pw12"}, headers=h)
    assert dupe.status_code == 409

    ok = await client.post(
        "/api/auth/register", json={"username": "bobby", "password": "pw12"}, headers=h)
    assert ok.status_code == 200
    assert ok.json()["username"] == "bobby"
