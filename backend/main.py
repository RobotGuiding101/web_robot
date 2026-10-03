import asyncio
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from anyio import to_thread
from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from database import engine, Base
from routers import auth, robot, camera, mapcontrol
from routers import scan as scan_router
from routers.auth import get_current_user, SECRET_KEY, ALGORITHM
from routers import settings as settings_router
from routers import devices as devices_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Each MJPEG client parks one threadpool worker for its whole session, and
    # every sync robot call takes another — the 40-thread default is easy to
    # starve on a Pi with a few viewers plus the 1-2s status polls.
    to_thread.current_default_thread_limiter().total_tokens = 80

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    def _auto_start_camera():
        from routers.mapcontrol import cam, robot, state
        from maps_point.camera import list_devices
        time.sleep(2.0)

        # Enumerate BEFORE any pipeline streams — a second rs.context() while
        # streaming deadlocks librealsense (see routers/camera.py's /scan).
        try:
            devices = list_devices()
            if devices:
                state.camera_devices = devices
            print(f"[AutoStart] devices={[d.get('serial') for d in devices]}", flush=True)
        except Exception as e:
            print(f"[AutoStart] device list failed: {e}", flush=True)

        saved = {}
        try:
            from routers.camera import load_saved_selection
            saved = load_saved_selection()
            if saved.get("primary"):
                cam.set_serial(saved["primary"])
                print(f"[AutoStart] resume primary serial={saved['primary']}", flush=True)
        except Exception as e:
            print(f"[AutoStart] resume serial failed: {e}", flush=True)

        # D455 inter-cam sync (0 off / 1 master / 2 slave), needs the physical
        # sync cable. cam2 is set master before it starts, cam1 slave before
        # it starts — the two must agree on which is master or timestamps
        # never lock.
        from maps_point.config import CAM_INTER_SYNC
        cam.set_inter_cam_sync(CAM_INTER_SYNC)

        for attempt in range(1, 4):
            if cam._running:
                print(f"[AutoStart] camera already running (attempt {attempt})", flush=True)
                break
            try:
                if cam.start():
                    print(f"[AutoStart] camera started (attempt {attempt})", flush=True)
                    break
                print(f"[AutoStart] camera start returned False (attempt {attempt}/3)", flush=True)
            except Exception as e:
                print(f"[AutoStart] camera failed (attempt {attempt}/3): {e}", flush=True)
            if attempt < 3:
                time.sleep(5.0)

        try:
            from routers.camera import start_cam2_once
            c2 = start_cam2_once(saved.get("secondary"))
            print(f"[AutoStart] cam2 running={bool(c2 and c2._running)}", flush=True)
        except Exception as e:
            print(f"[AutoStart] cam2 start failed: {e}", flush=True)

        def _connect_robot():
            try:
                if not robot.connected:
                    robot.connect()
                print(f"[AutoStart] robot connected={robot.connected}", flush=True)
            except Exception as e:
                print(f"[AutoStart] robot connect failed: {e}", flush=True)

        threading.Thread(target=_connect_robot, daemon=True).start()

    threading.Thread(target=_auto_start_camera, daemon=True).start()
    asyncio.create_task(_joint_broadcast_loop())
    yield


app = FastAPI(title="Robot Arm API", version="0.2.0", lifespan=lifespan)

OPEN_PREFIXES = ("/api/auth/",)


@app.middleware("http")
async def require_bearer_token(request: Request, call_next):
    path = request.url.path
    if (path.startswith("/api/")
            and not path.startswith(OPEN_PREFIXES)
            and request.method != "OPTIONS"):
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        try:
            jwt.decode(header.split(" ", 1)[1], SECRET_KEY, algorithms=[ALGORITHM])
        except JWTError:
            return JSONResponse({"detail": "Invalid token"}, status_code=401)
    return await call_next(request)


# ---------------------------------------------------------------------------
# CORS — อ่านจาก env ALLOWED_ORIGINS (คั่นด้วยคอมม่า)
# ต้อง add หลัง auth middleware เพื่อให้ CORS เป็นชั้นนอกสุด (401 ยังมี CORS header)
# ---------------------------------------------------------------------------
origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
allowed_origins = [o.strip() for o in origins_raw.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth.router,          prefix="/api/auth",    tags=["Auth"])
app.include_router(settings_router.router)                              # /api/settings
app.include_router(robot.router,         prefix="/api/robot",   tags=["Robot"],
                   dependencies=[Depends(get_current_user)])
app.include_router(camera.router,        prefix="/api/camera",  tags=["Camera"],
                   dependencies=[Depends(get_current_user)])
app.include_router(mapcontrol.router,
                   dependencies=[Depends(get_current_user)])
app.include_router(devices_router.router,
                   dependencies=[Depends(get_current_user)])
# scan router: REST routes carry their own auth dependency; router-level
# dependencies would also run for its websocket routes and reject them with
# 401 (the token is a query param there, not an Authorization header).
app.include_router(scan_router.router)


@app.get("/")
def root():
    return {"message": "Robot Arm API is running"}


# ── WebSocket: high-rate joint feed for the 3D viewer ────────────────────────
# The viewer needs the arm to move smoothly, but the dashboard TCP port can only
# be polled; at HTTP cadence the model visibly stepped. One broadcaster polls
# GetAngle and pushes to every connected viewer so N viewers cost one poll.
_joint_clients: set = set()


async def _joint_broadcast_loop():
    from routers.mapcontrol import robot
    tick = 0
    while True:
        if not _joint_clients:
            await asyncio.sleep(0.5)
            tick = 0
            continue
        try:
            connected = bool(robot.connected)
            if connected:
                angles = await to_thread.run_sync(robot.get_angle)
                pose = await to_thread.run_sync(robot.get_pose) if tick % 2 == 0 else None
            else:
                angles = [0.0] * 6
                pose = [0.0] * 6 if tick % 2 == 0 else None
            msg = {"angles": [float(a) for a in angles], "connected": connected}
            if pose is not None:
                msg["pose"] = [float(p) for p in pose]
            payload = json.dumps(msg)
            for ws in list(_joint_clients):
                try:
                    await ws.send_text(payload)
                except Exception:
                    _joint_clients.discard(ws)
        except Exception:
            pass
        tick += 1
        await asyncio.sleep(0.05)


@app.websocket("/ws/joints")
async def ws_joints(websocket: WebSocket, token: str = ""):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    _joint_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _joint_clients.discard(websocket)
