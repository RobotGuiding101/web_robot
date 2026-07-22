from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import auth, robot, camera

app = FastAPI(title="Robot Arm API", version="0.1.0")

# ---------------------------------------------------------------------------
# CORS — allow the React dev server to call this API
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
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


@app.get("/")
def root():
    return {"message": "Robot Arm API is running"}
