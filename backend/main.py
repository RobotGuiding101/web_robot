import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import auth, robot, camera, mapcontrol

load_dotenv()  # โหลด .env

app = FastAPI(title="Robot Arm API", version="0.1.0")

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
app.include_router(auth.router,   prefix="/api/auth",   tags=["Auth"])
app.include_router(robot.router,  prefix="/api/robot",  tags=["Robot"])
app.include_router(camera.router, prefix="/api/camera", tags=["Camera"])
app.include_router(mapcontrol.router)


@app.get("/")
def root():
    return {"message": "Robot Arm API is running"}
