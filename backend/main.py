import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()  # Load .env BEFORE importing database (which reads DATABASE_URL)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import auth, robot, camera, mapcontrol
from routers import settings as settings_router
from routers import devices as devices_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables on startup (idempotent)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="Robot Arm API", version="0.2.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS — อ่านจาก env ALLOWED_ORIGINS (คั่นด้วยคอมม่า)
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
app.include_router(robot.router,         prefix="/api/robot",   tags=["Robot"])
app.include_router(camera.router,        prefix="/api/camera",  tags=["Camera"])
app.include_router(mapcontrol.router)
app.include_router(devices_router.router)                               # /api/devices


@app.get("/")
def root():
    return {"message": "Robot Arm API is running"}
