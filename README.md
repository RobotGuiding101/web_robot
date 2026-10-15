# Web Robot — Control Center & Dashboard for Robotic Arm

Web Robot คือเว็บแอปพลิเคชันสำหรับควบคุมและติดตามสถานะของหุ่นยนต์แขนกล **Dobot CR5** ร่วมกับกล้อง **Intel RealSense D455** แบบเรียลไทม์ ผ่านหน้าเว็บ Interactive รองรับ Jog Control (Cartesian/Joint), ดูภาพกล้องสดได้สูงสุด 2 ตัว, โหมดวาดภาพ (Drawing Mode), Auto-Align ระนาบด้วย depth และระบบหยุดฉุกเฉิน (Emergency Stop)

ระบบรันบน **Raspberry Pi 5** ในรูปแบบ Docker stack (FastAPI + React + PostgreSQL) และเข้าถึงจากระยะไกลผ่าน **Cloudflare Tunnel** ได้

---

## สารบัญ

- [Quick Start](#quick-start)
- [ความสามารถหลัก](#ความสามารถหลัก-key-features)
- [เทคโนโลยีที่ใช้](#เทคโนโลยีที่ใช้-tech-stack)
- [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์-project-structure)
- [สถาปัตยกรรมระบบ](#สถาปัตยกรรมระบบ-system-architecture)
- [Backend Control Pipeline](#backend-control-pipeline-backendmaps_point)
- [ฐานข้อมูล](#ฐานข้อมูล-database)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints-ย่อ)
- [Frontend Routes](#frontend-routes--pages)
- [3D Robot Viewer](#3d-robot-viewer-robot-viewerhtml)
- [การทดสอบ](#การทดสอบ-testing)
- [Development Commands](#development-commands)
- [Deploy บน Raspberry Pi](#deploy-บน-raspberry-pi)
- [ความปลอดภัย](#ความปลอดภัย-security)

---

## Quick Start

ต้องการ Docker, Node.js 18+, Python 3.10+ และ Git

```bash
git clone <repo-url>
cd web_robot

cp backend/.env.example      backend/.env
cp frontend/.env.example     frontend/.env
cp backend/.maps_point.env.example backend/.maps_point.env

docker compose up -d --build
```

| Service | URL |
|---|---|
| Web application | `http://<host>` |
| Backend API | `http://<host>:8000` |
| Swagger | `http://<host>:8000/docs` |

ตั้งค่า `.env` ให้ตรงเครื่องก่อนใช้งานจริง โดยเฉพาะ `JWT_SECRET` และ `ROBOT_IP` — ดู [Environment Variables](#environment-variables)

**การรันแบบ Development (ไม่ใช้ Docker)**

```bash
# Backend
cd backend
python -m venv venv
venv/Scripts/activate              # Windows
source venv/bin/activate           # macOS / Linux
pip install -r requirements.txt -r requirements-dev.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend (อีก terminal)
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

---

## ความสามารถหลัก (Key Features)

**Dobot Controller**
- Cartesian Control (X, Y, Z, RX, RY, RZ) และ Joint Control (J1–J6)
- Step 0.1 / 1 / 5 / 10 mm และ deg พร้อม Live Coordinate Readout ผ่าน WebSocket
- 3D Model Viewer (Three.js + โมเดล `.dae`) รองรับการลากปลายแขนด้วย IK
- ปุ่ม Home ใช้พิกัดที่ตั้งไว้แยกต่อผู้ใช้

**Real-Time Camera (สูงสุด 2 ตัว)**
- สตรีม MJPEG จาก RealSense D455 โหมด `rgb` / `gray` / `depth`
- สแกน เลือก และสลับกล้องหลัก–รอง โดยจำค่าไว้ข้ามการ restart
- Point cloud, depth grid และ Snapshot

**Auto-Align (ปรับระนาบด้วย depth)**
- วัดระนาบจาก depth ล้วนด้วย region growing
- Probe หาทิศทาง แล้ว converge tilt และแก้ roll (Rz)
- บันทึก recording ทุก step ลงดิสก์เพื่อตรวจสอบย้อนหลัง

**Drawing Mode**
- สอน grid N x M ด้วยการ jog มือ แล้ว map เส้นที่วาดด้วย bilinear
- Replay ต่อเนื่องผ่าน `movl_path` หรือ ServoP

**Persistent Settings และ Event Log (PostgreSQL)**
- เก็บ home, กล้องที่เลือก, รายการกล้อง และความเร็ว แยกต่อผู้ใช้
- บันทึก event (`robot` / `align` / `camera` / `estop` / `relay_v1`) พร้อมรายละเอียด

**ความปลอดภัย**
- ปุ่ม E-Stop จากทุกหน้า และปุ่มลัด spacebar
- ทุกคำสั่งเคลื่อนที่ถูก serialize ด้วย `robot_lock` เพื่อไม่ให้ชนกัน

**อื่น ๆ**
- Dashboard: Relay (Blynk), ping สถานะอุปกรณ์, ประวัติเหตุการณ์
- System Settings: Robot IP/ports, Home Position, Camera scan/select
- Responsive layout รองรับ Desktop, Tablet และ Mobile

---

## เทคโนโลยีที่ใช้ (Tech Stack)

### Frontend

| เทคโนโลยี | เวอร์ชัน | หน้าที่ |
|---|---|---|
| [React](https://react.dev/) | 19 | UI framework |
| [Vite](https://vitejs.dev/) | 8 | Build tool และ dev server |
| [React Router DOM](https://reactrouter.com/) | 7 | Client-side routing |
| [Fabric.js](https://fabricjs.com/) | 7 | Canvas สำหรับ Drawing Mode |
| [Three.js](https://threejs.org/) | r128 (CDN) | 3D robot viewer |
| Vanilla CSS | — | Design system |
| [Oxlint](https://oxc.rs/) | 1 | Linting |
| [Vitest](https://vitest.dev/) + Testing Library | 5 | Unit tests |

### Backend

| เทคโนโลยี | หน้าที่ |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) | Web framework และ ASGI server |
| Pydantic | Data validation |
| [python-dotenv](https://pypi.org/project/python-dotenv/) | โหลด env จาก `.env` และ `.maps_point.env` |
| OpenCV + numpy + pyrealsense2 | ประมวลผลภาพและเชื่อมกล้อง |
| SQLAlchemy (async) + asyncpg | ORM และ PostgreSQL driver |
| python-jose (JWT) + bcrypt | Authentication |
| pytest | Backend unit tests |

### Infrastructure

| เทคโนโลยี | หน้าที่ |
|---|---|
| PostgreSQL 16 | ฐานข้อมูล (users / settings / event log) |
| Docker + Docker Compose | Container orchestration |
| nginx (Alpine) | Static serving และ proxy `/api`, `/ws` |
| Cloudflare Tunnel (`cloudflared`) | เข้าถึงจากภายนอกแบบ HTTPS |
| Adminer | เว็บดูฐานข้อมูล (ตัวเลือก) |

---

## โครงสร้างโปรเจกต์ (Project Structure)

```text
web_robot/
├── README.md
├── docker-compose.yml             # PostgreSQL + Backend + Frontend
├── evidence/                      # CSV ผลทดสอบ + ภาพหลักฐาน
├── archive/                       # ไฟล์รุ่นเก่าที่ถูกแทนที่แล้ว
│
├── backend/                       # FastAPI server
│   ├── main.py                    # App entry, lifespan, middleware, /ws/joints
│   ├── database.py                # async engine + session (get_db)
│   ├── models.py                  # SQLAlchemy models (users / settings / logs)
│   ├── state_store.py             # persist marks/grid -> state_snapshot.json
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env / .env.example        # env หลัก (JWT, DATABASE_URL, CORS, Blynk)
│   ├── .maps_point.env            # env ของหุ่น/กล้อง/align/draw
│   ├── routers/
│   │   ├── auth.py                # /api/auth - register / login / me
│   │   ├── mapcontrol.py          # /api/map - สั่งหุ่น, กล้อง, status, stream
│   │   ├── camera.py              # /api/camera - stream / scan / select / swap / mode
│   │   ├── scan.py                # /api/scan - scan panel + WebSocket progress
│   │   ├── settings.py            # /api/settings - settings per user
│   │   ├── devices.py             # /api/devices - relay + event log + ping
│   │   ├── device_events.py       # best-effort event log writer
│   │   └── robot.py               # /api/robot - E-Stop เท่านั้น
│   ├── maps_point/                # ชั้นควบคุมฮาร์ดแวร์ (ไม่ผูก HTTP)
│   │   ├── config.py              # รวม config จาก .maps_point.env
│   │   ├── camera.py              # D455 pipeline + capture thread + depth
│   │   ├── robot.py               # Dobot SDK wrapper (2 ports, timeout)
│   │   ├── dobot_api_v3.py        # Dobot SDK (dashboard / move)
│   │   ├── align.py               # อัลกอริทึม align 3 เฟส
│   │   ├── planegrid.py           # grid plane + replay เส้นวาด (bilinear)
│   │   ├── motion.py              # pixel -> robot XY (eye-in-hand)
│   │   ├── floorcalib.py          # homography (eye-to-hand)
│   │   ├── render.py              # วาด overlay ลงเฟรม
│   │   ├── recording.py           # บันทึก align run ลงดิสก์
│   │   └── logs.py                # ring logs (server + robot)
│   └── tests/                     # pytest
│
└── frontend/                      # React + Vite web app
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── vitest.config.js
    ├── .oxlintrc.json
    ├── nginx.conf                 # nginx config สำหรับ Docker
    ├── Dockerfile                 # multi-stage: Node build -> nginx serve
    └── src/
        ├── App.jsx                # routing + RequireAuth + global stream dock
        ├── main.jsx
        ├── index.css              # global design system
        ├── lib/
        │   ├── api.js             # apiFetch (แนบ Bearer, retry, 401 -> login)
        │   ├── shapes.js          # ตรวจรูปทรงและ validation
        │   ├── robotLogFormat.js  # จัดรูปแบบ log
        │   ├── reportGate.js      # gate รายงานผลทดสอบ
        │   └── useJointsSocket.js # shared /ws/joints hook
        ├── components/
        │   ├── Sidebar.jsx        # nav + speed + logout
        │   ├── TopBar.jsx         # title + connection + E-Stop
        │   ├── CameraStream.jsx   # canvas MJPEG (abort when hidden)
        │   ├── RobotLogPanel.jsx  # แผง log ฝั่งขวา
        │   ├── RequireAuth.jsx    # auth guard
        │   └── ApiErrorBanner.jsx
        └── pages/
            ├── LoginPage.jsx
            ├── DashboardPage.jsx
            ├── DobotControllerPage.jsx
            ├── CameraViewPage.jsx
            ├── DrawingModePage.jsx
            ├── LogsPage.jsx
            └── SystemSettingsPage.jsx
    └── public/
        ├── robot-viewer.html      # Three.js viewer (iframe)
        ├── viewer-boot.js         # โหลดโมเดลและแสดงผล
        ├── viewer-loop.js         # render loop
        ├── viewer-gizmo.js        # gizmo ลากหุ่น + TIP
        ├── viewer-ik.js           # IK / joint apply
        ├── viewer-projector.js    # project world -> pixel
        ├── viewer-scan-align.js   # scan/align overlay
        ├── viewer-host-bridge.js  # bridge ไป React host
        └── models/                # โมเดล .dae (base_link, Link1..Link6, Link6_S)
```

---

## สถาปัตยกรรมระบบ (System Architecture)

```mermaid
graph TD
    User([Operator]) <-->|HTTPS| CF[Cloudflare Tunnel]
    CF --> NG[nginx :80]
    NG -->|/api/*| API["FastAPI (uvicorn) :8000"]
    NG -->|/ws| API
    NG -->|static| FE[React SPA]

    API -->|librealsense| CAM["RealSense D455 (1-2 ตัว)"]
    API -->|TCP 29999 / 30003| DOB[Dobot CR5]
    API --> PG[(PostgreSQL)]
    FE -->|iframe| VIEW["Three.js viewer"]
    FE <-->|WebSocket| API
```

**หลักการสำคัญ**

- กล้องและหุ่นเป็น singleton ที่มีเธรดเดียว (single capture thread + shared buffers) ทุก endpoint อ่านผ่าน getter ที่ thread-safe
- คำสั่งเคลื่อนที่ทั้งหมดถูก serialize ด้วย `robot_lock` (RLock) เพื่อไม่ให้ชนกัน
- การเข้ารหัสถูกบังคับใช้ที่ระดับ middleware ครอบทุก `/api/*` และ WebSocket

---

## Backend Control Pipeline (`backend/maps_point/`)

| โมดูล | หน้าที่ |
|---|---|
| `camera.py` | เปิด pipeline D455, เธรด capture เดียวเขียน shared buffers (`_color_buf`, `_depth_buf`), depth-only region growing สำหรับหาวัตถุ |
| `robot.py` | wrapper Dobot SDK — dashboard (29999) + move (30003), `SOCKET_TIMEOUT_S=3.0`, `go_home`, `movl`, `movl_path`, `servo_stream`, `_wait_stable` |
| `align.py` | align 3 เฟส: probe sign -> converge tilt (rx/ry) -> correct roll (rz) พร้อม guard ต่าง ๆ (diverge, recenter, re-probe, rmse) |
| `planegrid.py` | bilinear grid -> replay เส้นวาดต่อเนื่อง (`movl_path` + corner rounding หรือ ServoP) |
| `motion.py` | แปลง pixel เป็น robot XY (eye-in-hand) สำหรับ Goto |
| `floorcalib.py` | homography (eye-to-hand) จาก 4 จุดขึ้นไป เป็น absolute robot XY |
| `recording.py` | บันทึก align run (JPEG + log) ลง `recordings/align_<timestamp>/` |
| `logs.py` | ring log 2 ตัว (`log` / `robot_log`) ป้อนหน้าเว็บผ่าน `/api/logs` |

---

## ฐานข้อมูล (Database)

PostgreSQL 16 มี 3 ตาราง สร้างอัตโนมัติจาก SQLAlchemy `Base.metadata` ตอน startup

| ตาราง | เนื้อหา |
|---|---|
| `users` | บัญชีผู้ใช้ (`username` unique, `password_hash` = bcrypt) |
| `user_settings` | key/value ต่อผู้ใช้: `home_*`, `cam_serial`, `cam_serial2`, `cam_devices` (JSON), `sidebar_speed` |
| `device_logs` | event log (`robot` / `align` / `camera` / `estop` / `relay_v1`) พร้อมคอลัมน์ `detail` |

โครงสร้างตารางและความสัมพันธ์ทั้งหมดดูได้จาก `backend/models.py` ส่วนการเชื่อมต่อทำงานแบบ async ผ่าน `get_db()` dependency ซึ่งปิด session อัตโนมัติ

> หมายเหตุ: `create_all` สร้างเฉพาะตารางที่ยังไม่มี ไม่เพิ่มคอลัมน์ให้ตารางเดิม ถ้าต้องเพิ่มคอลัมน์ใหม่ต้องรัน `ALTER TABLE` เอง

### ดูฐานข้อมูลด้วย Adminer

```bash
docker run -d --name robot_adminer --restart unless-stopped \
  --network robot_network -p 8080:8080 adminer:latest
```

| ช่อง | ค่า |
|---|---|
| System | `PostgreSQL` |
| Server | `robot_postgres` |
| Username | `robot` |
| Password | `robot123` |
| Database | `robot_settings` |

> เข้าได้ที่ `http://<host>:8080` — Adminer เข้าถึงฐานข้อมูลได้เต็มสิทธิ์ จึงไม่ควรเปิดสู่ public โดยไม่มีการป้องกัน

---

## Environment Variables

### Frontend (`frontend/.env`)

| Variable | Default | คำอธิบาย |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | URL ของ backend API (dev) |
| `VITE_WS_URL` | `ws://localhost:8000` | WebSocket URL (dev) |

> ในโปรดักชันแอปเรียกแบบ same-origin (`/api`, `/ws`) ผ่าน nginx และ WebSocket hook สร้าง URL จาก `location.host` เอง

### Backend (`backend/.env`)

| Variable | Default | คำอธิบาย |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8000` | bind address ของ uvicorn |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origins (คั่นด้วยคอมม่า) |
| `DATABASE_URL` | `postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings` | PostgreSQL DSN |
| `JWT_SECRET` | — | บังคับต้องตั้งค่า: backend จะไม่ start ถ้าเว้นว่าง เป็นค่า placeholder ที่รู้จัก หรือยาวน้อยกว่า 16 ตัวอักษร |
| `ROBOT_IP` / `ROBOT_PORT` | `192.168.10.110` / `29999` | ตัวควบคุม Dobot |
| `BLYNK_TOKEN` | — | Token ของ Blynk สำหรับ relay |

### ค่าฮาร์ดแวร์ (`backend/.maps_point.env`)

โหลดโดย `maps_point/config.py` ด้วย `override=True`

| กลุ่ม | ตัวแปร |
|---|---|
| robot / camera | `ROBOT_IP`, `DEPTH_CAM_SERIAL`, `MIN_DEPTH_MM`, `DEPTH_N_FRAMES`, `DEPTH_ROI`, `CAM_X_SIGN`, `CAM_Y_SIGN`, `CAM_TCP_OFFSET_X/Y`, `WELD_TOOL_INDEX` |
| align | `ALIGN_GAIN_DEG`, `ALIGN_TOL_DEG`, `ALIGN_MAX_STEPS`, `ALIGN_PROBE_DEG`, `ALIGN_MAX_RMSE_MM`, `ALIGN_RZ_*` |
| draw | `DRAW_SIMPLIFY_EPS`, `DRAW_MAX_POINTS`, `DRAW_GRID_MAX_ROWS`, `DRAW_GRID_MAX_COLS`, `DRAW_CP_RATIO`, `DRAW_MOTION_MODE`, `DRAW_SERVOP_*` |
| home / surface | `HOME_X/Y/Z`, `HOME_RX/RY/RZ`, `Z_SURFACE`, `CAM_TIP_OFFSET_MM`, `DRAW_SURFACE_GAP_MM` |

> กล้องตัวที่สองไม่ได้ตั้งผ่าน env แต่เลือกผ่าน API (`POST /api/camera/select` หรือ `/swap`) แล้วบันทึกลง `backend/camera_selection.json` ซึ่ง backend จะอ่านตอน boot

> สำคัญ: `env_file` ของ Docker Compose ฝังค่าไว้ตั้งแต่ตอนสร้าง container แก้ `.env` แล้ว `docker restart` ไม่พอ ต้องใช้ `docker compose up -d --force-recreate backend`

---

## API Endpoints (ย่อ)

ทุก endpoint ใต้ `/api/*` ต้องมี header `Authorization: Bearer <JWT>` และ endpoint ภายใต้ `/api/auth/*` เป็นเพียงข้อยกเว้น

### Authentication (`/api/auth`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | เข้าสู่ระบบ `{ "username", "password" }` แล้วรับ JWT (อายุ 72 ชั่วโมง) |
| `POST` | `/api/auth/register` | สร้างผู้ใช้ใหม่ (ต้องล็อกอินอยู่ก่อน) |
| `GET` | `/api/auth/me` | ข้อมูลผู้ใช้ปัจจุบัน |

### Robot / Map (`/api/map`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/map/status` | สถานะหุ่น + กล้อง + joint/tcp + sequence |
| `POST` | `/api/map/connect`, `/init`, `/camstart` | ต่อหุ่น / ตั้งค่าเริ่มต้น / เปิดกล้อง |
| `POST` | `/api/map/home` | ไปตำแหน่ง home (ใช้ค่า per-user จาก DB) |
| `POST` | `/api/map/goto`, `/point` | ย้ายไปตำแหน่ง / มาร์กจุดของ align |
| `POST` | `/api/map/jog`, `/jog_joint` | ขยับแบบ cartesian / joint (reject เมื่อ busy) |
| `POST` | `/api/map/align`, `/draw`, `/stop` | auto-align / วาดตาม grid / หยุด |
| `GET` | `/api/map/video_feed`, `/pointcloud`, `/depth_grid`, `/color_frame` | MJPEG / point cloud / depth grid / เฟรม |
| `POST` | `/api/map/emergency` | หยุดฉุกเฉิน พร้อมยกเลิก align/draw |
| `GET`/`POST` | `/api/map/grid/*`, `/frame`, `/heatmap/toggle` | grid, coordinate frame, heatmap |

### Camera (`/api/camera`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/camera/stream`, `/stream2` | MJPEG กล้องหลัก / รอง (`?mode=rgb|gray|depth`) |
| `GET` | `/api/camera/snapshot`, `/snapshot2` | ภาพนิ่ง (`image/jpeg`) |
| `GET` | `/api/camera/devices` | กล้องที่เลือกอยู่ + รายการที่สแกนได้ |
| `POST` | `/api/camera/scan`, `/select`, `/swap` | สแกน / เลือกกล้องหลัก / สลับหลัก-รอง |
| `GET`/`POST` | `/api/camera/mode`, `/mode2`, `/mode/toggle` | โหมดแสดงผลของกล้องแต่ละตัว |
| `GET` | `/api/camera/pointcloud2`, `/depth_grid2` | point cloud และ depth grid ของกล้องรอง |

### Settings / Devices

| Method | Endpoint | Description |
|---|---|---|
| `GET`/`PUT` | `/api/settings` | settings ต่อผู้ใช้ (home / camera / speed) |
| `POST` | `/api/devices/relay/toggle` | สลับ relay (Blynk) และบันทึก log |
| `GET` | `/api/devices/relay/state`, `/relay/history` | สถานะและประวัติ relay |
| `GET` | `/api/devices/events` | event log ล่าสุด |
| `POST` | `/api/devices/events/prune` | ตัด event log เก่า |
| `GET` | `/api/devices/ping` | ping สถานะอุปกรณ์ |

### WebSocket

| Endpoint | Payload |
|---|---|
| `/ws/joints?token=<JWT>` | `{ angles (~20Hz), pose (~10Hz), connected }` |

---

## Frontend Routes & Pages

| Path | หน้า | หน้าที่ |
|---|---|---|
| `/login` | LoginPage | เข้าสู่ระบบ |
| `/dashboard` | DashboardPage | Relay toggle + ping + เมนู |
| `/dobot` | DobotControllerPage | Jog + 3D viewer + live coordinates |
| `/camera` | CameraViewPage | กล้องสด 2 ตัว + mode + snapshot |
| `/drawing` | DrawingModePage | สอน grid + วาด + align + teach panel |
| `/settings` | SystemSettingsPage | Robot IP/ports, Home Position, Camera scan/select |

> ทุกหน้ายกเว้น `/login` ถูกป้องกันด้วย `RequireAuth` ซึ่งตรวจ JWT ใน localStorage

---

## 3D Robot Viewer (`/robot-viewer.html`)

Three.js viewer ที่โหลดโมเดล `.dae` จริง รองรับ:

| ฟีเจอร์ | วิธีใช้ |
|---|---|
| IK Drag | ลากลูกบอลสีส้มที่ปลายแขนเพื่อขยับทุกข้อต่อ (CCD IK) |
| Translate / Rotate | กด `Space` เพื่อสลับโหมด |
| หมุนกล้อง / Zoom | คลิกพื้นหลังแล้วลาก / เลื่อนล้อเมาส์ |
| Live Coordinates | ส่ง X/Y/Z/RX/RY/RZ และ J1–J6 (interpolated) ไปยัง panel |
| ควบคุมจาก React | `iframe.contentWindow.postMessage({ type: 'setJoints', joints: [...] }, '*')` |

---

## การทดสอบ (Testing)

```bash
# Backend (pytest) - ใช้ aiosqlite แทน PostgreSQL จริง
cd backend && python -m pytest

# Frontend (vitest)
cd frontend && npm run test
```

| ฝั่ง | ชุดทดสอบ |
|---|---|
| Backend | `test_planegrid` (bilinear/grid/validate), `test_config` (env/type), `test_models` (UUID/unique), `test_auth` (JWT/bcrypt/login), `test_floorcalib` (homography), `test_pose_source` (แหล่งข้อมูล pose) |
| Frontend | `lib/api.test.js`, `lib/shapes.test.js`, `lib/robotLogFormat.test.js`, `reportGate.test.js`, `ApiErrorBanner.test.jsx`, `RequireAuth.test.jsx`, `DrawingModePage.smoke.test.jsx` |

> `requirements-dev.txt` ไม่รวม `pyrealsense2` โดยเจตนา เพราะเป็น hardware-only dependency ทำให้รันเทสต์ได้โดยไม่ต้องต่อกล้องจริง

**ผลทดสอบ manual** 150 เคส (102 เคสเดิม + 48 เคสใหม่: Align, Scan, Activity Log, Public Access, Automated Unit Tests) อยู่ใน `evidence/test_cases_verified.csv` และ `evidence/manual_results_observed.csv` พร้อมภาพหลักฐานในโฟลเดอร์เดียวกัน

---

## Development Commands

```bash
cd frontend
npm run lint          # oxlint
npm run build         # production build
npm run preview       # preview build
npm run test:watch    # vitest watch mode

docker compose build backend
docker compose build frontend
```

---

## Deploy (บน Raspberry Pi)

- **Backend** เป็น bind mount (`./backend:/app`) แก้โค้ดแล้ว `docker restart robot_backend` เห็นผลทันที
- **Frontend** เป็น image ที่ build จาก Dockerfile แบบ multi-stage (Node build -> nginx serve) ต้อง rebuild image เมื่อแก้โค้ด: `docker compose build frontend && docker compose up -d frontend`
- เปิดให้เข้าถึงจากภายนอกผ่าน **Cloudflare Tunnel** (คอนเทนเนอร์ `cloudflared`) ไปยัง nginx
- กล้องและหุ่นเข้าถึงได้โดยตรงเพราะ `backend` ใช้ `network_mode: host` (จำเป็นสำหรับ USB ของ RealSense)

---

## ความปลอดภัย (Security)

1. **Emergency Stop** — POST ทันทีเมื่อกดปุ่ม E-Stop และยกเลิกงาน align/draw ที่ค้างอยู่
2. **Authentication** — ทุก `/api/*` และ WebSocket ต้องมี JWT (Bearer) และ `JWT_SECRET` ถูกบังคับตั้งค่าให้แข็งแรง
3. **Move lock** — ทุกคำสั่งเคลื่อนที่ถูก serialize ด้วย `robot_lock` และปฏิเสธ jog ระหว่าง align/draw/sequence
4. **CORS** — อ่านจาก `ALLOWED_ORIGINS` ไม่ hardcode
5. **Secrets** — `.env` และ `.maps_point.env` อยู่ใน `.gitignore` ห้าม commit
6. **PostgreSQL** — bind เฉพาะ `127.0.0.1:5432` ไม่เปิดออกเน็ต
7. **Docker** — multi-stage build ทำให้ image สุดท้ายไม่มี Node.js source

---

## License & Credits

พัฒนาขึ้นสำหรับการเชื่อมต่อและควบคุมหุ่นยนต์แขนกล Dobot CR5 ร่วมกับ Intel RealSense D455 ผ่านเว็บเทคโนโลยี (FastAPI + React + Three.js)