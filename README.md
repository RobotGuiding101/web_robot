# 🤖 Web Robot — Control Center & Dashboard for Robotic Arm

**Web Robot** คือเว็บแอปพลิเคชันสำหรับควบคุมและติดตามสถานะของหุ่นยนต์แขนกล **Dobot CR5** ร่วมกับกล้อง **Intel RealSense D455** แบบเรียลไทม์ ผ่านหน้าเว็บ Interactive รองรับ Jog Control (Cartesian/Joint), ดูภาพกล้องสด (ได้ถึง 2 ตัว), โหมดวาดภาพ (Drawing Mode), Auto-Align ระนาบด้วย depth, และระบบหยุดฉุกเฉิน (Emergency Stop)

ระบบรันบน **Raspberry Pi 5** เป็น Docker stack (FastAPI + React + PostgreSQL) และสามารถเปิดให้เข้าถึงจากระยะไกลผ่าน **Cloudflare Tunnel** ได้

### 📚 เอกสารประกอบ (Documentation Index)

| เอกสาร | เนื้อหา |
|---|---|
| **[HANDOFF.md](HANDOFF.md)** | 📦 **จุดส่งมอบงาน** — สถานะปัจจุบัน, วิธีรัน/ทดสอบ, รายการงานค้าง |
| **[DATABASE.md](DATABASE.md)** | โครงสร้างฐานข้อมูล (schema / ER diagram) |
| **[BACKEND_CAMERA_DOBOT.md](BACKEND_CAMERA_DOBOT.md)** | การออกแบบ backend (กล้อง / Dobot / align) |
| **[CAMERA_STREAM.md](CAMERA_STREAM.md)** | กล้อง 2 ตัว, การเชื่อมต่อ, MJPEG stream, pyrealsense2 + OpenCV |
| **[TEST_CASES.md](TEST_CASES.md)** | สเปกชุดทดสอบ (102 เคส) |
| **[MANUAL_TESTS_ON_SITE.md](MANUAL_TESTS_ON_SITE.md)** | คู่มือทดสอบ manual หน้างาน (on-site runbook) |
| **[TEST_CASES_new.xlsx](TEST_CASES_new.xlsx)** | ผลทดสอบจริง 150 เคส (ค่าที่รันแล้ว) |
| **[evidence/](evidence/)** | ผลทดสอบ + ภาพหลักฐาน (`test_cases_verified.csv`, `manual_results_observed.csv`, PNG) |
| **[archive/](archive/)** | ไฟล์รุ่นเก่าที่ถูกแทนที่แล้ว (ดู [archive/README.md](archive/README.md)) |

---

## 🌟 ฟีเจอร์หลัก (Key Features)

- 🎮 **Dobot Controller**
  - Cartesian Control (X, Y, Z, RX, RY, RZ) และ Joint Control (J1–J6)
  - Step 0.1 / 1 / 5 / 10 mm·deg + Live Coordinate Readout (WS)
  - 3D Model Viewer (Three.js + โมเดล `.dae`) + IK drag ที่ปลายแขน
  - Home ไปยังพิกัดที่ตั้งไว้ต่อผู้ใช้ (per-user)
- 📹 **Real-Time Camera (สูงสุด 2 กล้อง)**
  - MJPEG จาก RealSense D455 + โหมด `rgb` / `gray` / `depth`
  - สแกน/เลือกกล้องหลัก–รอง และจำค่าไว้ข้าม restart
  - Point cloud + depth grid, Snapshot
- 🎯 **Auto-Align (ปรับระนาบด้วย depth)**
  - วัดระนาบจาก depth ล้วน (region growing) → probe หาทิศทาง → converge tilt → แก้ roll (Rz)
  - บันทึก recording ทุก step ลงดิสก์เพื่อ debug
- 🎨 **Drawing Mode**
  - สอน grid N×M ด้วยการ jog มือ → map เส้นที่วาดด้วย bilinear → replay (MovL queued `movl_path` หรือ ServoP)
- 🗄️ **Persistent Settings & Event Log (PostgreSQL)**
  - เก็บ home / กล้องที่เลือก / รายการกล้อง / speed ต่อผู้ใช้
  - บันทึก event (`robot` / `align` / `camera` / `estop` / `relay_v1`) พร้อม `detail`
- 🚨 **Safety & Emergency Stop** — ปุ่ม E-Stop จากทุกหน้า + spacebar; serialize ทุกคำสั่งเคลื่อนที่ (กันคำสั่งชนกัน)
- 📊 **Dashboard** — Relay (Blynk) + ping สถานะอุปกรณ์ + ประวัติ
- ⚙️ **System Settings** — Robot IP/ports, Home Position, Camera scan/select
- 📱 **Responsive** — Desktop, iPad และ Mobile (bottom nav)

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

### **Frontend**
| เทคโนโลยี | เวอร์ชัน | หน้าที่ |
|---|---|---|
| [React](https://react.dev/) | 19 | UI Framework |
| [Vite](https://vitejs.dev/) | 8 | Build Tool & Dev Server |
| [React Router DOM](https://reactrouter.com/) | 7 | Client-side Routing |
| [Fabric.js](https://fabricjs.com/) | 7 | Canvas วาดภาพ (Drawing Mode) |
| [Three.js](https://threejs.org/) | r128 (CDN) | 3D Robot Model Viewer |
| Vanilla CSS | — | Design System (Dark / Glassmorphism) |
| [Oxlint](https://oxc.rs/) | 1 | Linting |
| [Vitest](https://vitest.dev/) + Testing Library | 5 | Unit tests |

### **Backend**
| เทคโนโลยี | หน้าที่ |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) | Web framework + ASGI server |
| Pydantic | Data validation |
| [python-dotenv](https://pypi.org/project/python-dotenv/) | โหลด env (`.env`, `.maps_point.env`) |
| OpenCV + numpy + pyrealsense2 | ประมวลผลภาพ / กล้อง |
| SQLAlchemy (async) + asyncpg | ORM + PostgreSQL driver |
| python-jose (JWT) + bcrypt | Authentication |
| pytest | Backend unit tests |

### **Infrastructure**
| เทคโนโลยี | หน้าที่ |
|---|---|
| PostgreSQL 16 | ฐานข้อมูล (users / settings / event log) |
| Docker + Docker Compose | Container orchestration |
| nginx (Alpine) | Static serving + proxy `/api` และ `/ws` |
| Cloudflare Tunnel (`cloudflared`) | เข้าถึงจากภายนอกแบบ HTTPS (deploy บน Pi) |
| Adminer | เว็บดูฐานข้อมูล (ทางเลือก) |

---

## 📂 โครงสร้างโปรเจกต์ (Project Structure)

```text
web_robot/
├── README.md
├── HANDOFF.md                     # 📦 จุดส่งมอบงาน (สถานะ/วิธีรัน/งานค้าง)
├── DATABASE.md                    # ER diagram + schema ฐานข้อมูล
├── BACKEND_CAMERA_DOBOT.md        # สรุปการออกแบบ backend (กล้อง/หุ่น)
├── CAMERA_STREAM.md               # กล้อง 2 ตัว + การเชื่อมต่อ + MJPEG stream
├── TEST_CASES.md                  # สเปกชุด test case (102 เคส)
├── MANUAL_TESTS_ON_SITE.md        # runbook ทดสอบ manual หน้างาน
├── TEST_CASES_new.xlsx            # ผลทดสอบจริง 150 เคส
├── docker-compose.yml             # PostgreSQL + Backend + Frontend
├── evidence/                      # CSV ผลทดสอบ + ภาพหลักฐาน
├── archive/                       # ไฟล์รุ่นเก่าที่ถูกแทนที่แล้ว
│
├── backend/                      # FastAPI Server
│   ├── main.py                   # App entry, lifespan, middleware, /ws/joints
│   ├── database.py               # async engine + session (get_db)
│   ├── models.py                 # SQLAlchemy models (users/settings/logs)
│   ├── state_store.py            # persist marks/grid → state_snapshot.json
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env / .env.example       # env หลัก (JWT, DATABASE_URL, CORS, Blynk)
│   ├── .maps_point.env           # env ของหุ่น/กล้อง/align/draw (overrides)
│   ├── routers/
│   │   ├── auth.py               # /api/auth — Register/Login/Me (JWT)
│   │   ├── mapcontrol.py         # /api/map — สั่งหุ่น/กล้อง/status/stream
│   │   ├── camera.py             # /api/camera — stream/scan/select/swap/mode
│   │   ├── scan.py               # /api/scan — scan panel + WS progress
│   │   ├── settings.py           # /api/settings — settings per-user
│   │   ├── devices.py            # /api/devices — relay + event log + ping
│   │   ├── device_events.py      # best-effort event-log writer
│   │   └── robot.py              # /api/robot — E-Stop เท่านั้น
│   ├── maps_point/               # ชั้นควบคุมฮาร์ดแวร์ (ไม่ผูก HTTP)
│   │   ├── config.py             # รวม config จาก .maps_point.env
│   │   ├── camera.py             # D455 pipeline + capture thread + depth
│   │   ├── robot.py              # Dobot SDK wrapper (2 ports, timeout)
│   │   ├── dobot_api_v3.py       # Dobot SDK (dashboard/move)
│   │   ├── align.py              # อัลกอริทึม align (ตรงกับ version_3.0)
│   │   ├── planegrid.py          # grid plane + replay เส้นวาด (bilinear)
│   │   ├── motion.py             # pixel → robot XY (eye-in-hand)
│   │   ├── floorcalib.py         # homography (eye-to-hand)
│   │   ├── render.py             # วาด overlay ลงเฟรม
│   │   ├── recording.py          # บันทึก align run ลงดิสก์
│   │   └── logs.py               # ring logs (server + robot)
│   └── tests/                    # pytest (planegrid/config/models/auth/floorcalib/pose)
│
└── frontend/                     # React + Vite Web App
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── vitest.config.js / .oxlintrc.json
    ├── nginx.conf                # nginx config สำหรับ Docker
    ├── Dockerfile                # Multi-stage: Node build → nginx serve
    └── src/
        ├── App.jsx               # Routing + RequireAuth + global stream dock
        ├── main.jsx
        ├── index.css             # Global Design System
        ├── lib/
        │   ├── api.js            # apiFetch (แนบ Bearer, retry, 401→login)
        │   ├── shapes.js         # ตรวจรูปทรง/validation ของข้อมูล
        │   ├── robotLogFormat.js # จัดรูปแบบ log
        │   ├── reportGate.js     # gate รายงานผลทดสอบ
        │   └── useJointsSocket.js# shared /ws/joints hook
        ├── components/
        │   ├── Sidebar.jsx       # nav + speed + logout
        │   ├── TopBar.jsx        # title + connection + E-Stop
        │   ├── CameraStream.jsx  # canvas MJPEG (abort when hidden)
        │   ├── RobotLogPanel.jsx # แผง log ฝั่งขวา
        │   ├── RequireAuth.jsx   # auth guard
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
        ├── robot-viewer.html     # Three.js 3D viewer (iframe)
        ├── viewer-boot.js        # โหลดโมเดล/แสดงผล (แยกจาก html แล้ว)
        ├── viewer-loop.js        # render loop
        ├── viewer-gizmo.js       # gizmo ลากหุ่น + TIP
        ├── viewer-ik.js          # IK / joint apply
        ├── viewer-projector.js   # project world → pixel
        ├── viewer-scan-align.js  # scan/align overlay
        ├── viewer-host-bridge.js # bridge ไป React host
        └── models/               # โมเดล .dae (base_link, Link1..Link6, Link6_S)
```

---

## 🏗️ สถาปัตยกรรมระบบ (System Architecture)

```mermaid
graph TD
    User([Operator]) <-->|HTTPS| CF[Cloudflare Tunnel]
    CF --> NG[nginx :80]
    NG -->|/api/*| API["FastAPI (uvicorn) :8000"]
    NG -->|/ws| API
    NG -->|static| FE[React SPA]

    API -->|librealsense| CAM["RealSense D455 (1–2 ตัว)"]
    API -->|TCP 29999 / 30003| DOB[Dobot CR5]
    API --> PG[(PostgreSQL)]
    FE -->|iframe| VIEW["Three.js viewer"]
    FE <-->|WebSocket| API
```

**หลักการ:** กล้อง/หุ่นเป็น **singleton + เธรดเดียว** (single capture thread + shared buffers) ทุก endpoint อ่านผ่าน getter ที่ thread-safe; คำสั่งเคลื่อนที่ทุกอย่างถูก serialize ด้วย `robot_lock` (RLock) เพื่อไม่ให้ชนกัน

---

## 🧠 Backend Control Pipeline (`backend/maps_point/`)

| โมดูล | ทำอะไร |
|---|---|
| `camera.py` | เปิด pipeline D455, **เธรด capture เดียว** เขียน shared buffers (`_color_buf`, `_depth_buf`), depth-only region growing สำหรับหาวัตถุ |
| `robot.py` | wrapper Dobot SDK — dashboard (29999) + move (30003), `SOCKET_TIMEOUT_S=3.0`, `go_home`, `movl`, `movl_path`, `servo_stream`, `_wait_stable` (ดู 6 DOF) |
| `align.py` | align 3 เฟส: probe sign → converge tilt (rx/ry) → correct roll (rz); มี guard (diverge, recenter, re-probe, rmse) |
| `planegrid.py` | bilinear grid → replay เส้นวาดต่อเนื่อง (`movl_path` + CP corner rounding หรือ ServoP) |
| `motion.py` | pixel → robot XY (eye-in-hand) สำหรับ Goto click |
| `floorcalib.py` | homography (eye-to-hand) จาก ≥4 จุด → absolute robot XY |
| `recording.py` | บันทึก align run (JPEG + log) ลง `recordings/align_<ts>/` |
| `logs.py` | ring log 2 ตัว (`log` / `robot_log`) ป้อนหน้าเว็บผ่าน `/api/logs` |

---

## 🗄️ ฐานข้อมูล (Database)

PostgreSQL 16 — 3 ตาราง: `users`, `user_settings`, `device_logs` (สร้างอัตโนมัติจาก SQLAlchemy `Base.metadata` ตอน startup)

- `user_settings` — key/value ต่อผู้ใช้: `home_*`, `cam_serial`/`cam_serial2`, `cam_devices` (JSON), `sidebar_speed`
- `device_logs` — event log (`robot` / `align` / `camera` / `estop` / `relay_v1`) + คอลัมน์ `detail`

> 📑 ดู **ER Diagram** + รายละเอียดทั้งหมดที่ **[DATABASE.md](DATABASE.md)**

### 🔎 ดูฐานข้อมูลด้วย Adminer (เหมือน phpMyAdmin)

```bash
# รันบนเครื่องเดียวกับ stack (ปรับ IP/พอร์ตตามต้องการ)
docker run -d --name robot_adminer --restart unless-stopped \
  --network robot_network -p 8080:8080 adminer:latest
```

| ช่อง | ค่า |
|---|---|
| System | `PostgreSQL` |
| Server | `robot_postgres` (หรือ `postgres`) |
| Username | `robot` |
| Password | `robot123` |
| Database | `robot_settings` |

> เข้าได้ที่ `http://<host-ip>:8080` — ⚠️ Adminer เข้าถึง DB ได้เต็ม อย่าเปิด public โดยไม่มี auth

---

## 🚀 การติดตั้งและการใช้งาน (Setup)

### 📋 ความต้องการของระบบ (Prerequisites)

- **แบบ Docker (แนะนำ):** Docker Desktop / Docker Engine v24+ (บน Pi: Raspberry Pi OS 64-bit)
- **แบบ Manual:** Node.js v18+, Python 3.10+, Git
- ฮาร์ดแวร์: Dobot CR5, Intel RealSense D455 (1–2 ตัว)

### 🐳 วิธีรันด้วย Docker (แนะนำ)

```bash
# 1. Clone
git clone <repo-url>
cd web_robot

# 2. สร้างไฟล์ env จาก template
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# (บนเครื่องจริงมี backend/.maps_point.env สำหรับค่าหุ่น/กล้องด้วย)

# 3. Build + รัน
docker compose up -d --build

# logs / หยุด
docker compose logs -f
docker compose down
```

| Service | URL |
|---|---|
| 🌐 **Frontend** | http://localhost |
| 🔌 **Backend API** | http://localhost:8000 |
| 📑 **Swagger Docs** | http://localhost:8000/docs |

> **หมายเหตุ**: nginx proxy `/api/*` และ `/ws` ไป backend อัตโนมัติ (same-origin → CORS ไม่มีปัญหา)
> ⚠️ `backend`/`frontend` ใช้ `network_mode: host` เพื่อเข้าถึง USB (RealSense) และหุ่นตรง ๆ

### 🛠️ วิธีรันแบบ Manual (Development)

**Backend**
```bash
cd backend
python -m venv venv
venv\Scripts\activate           # Windows
# source venv/bin/activate      # macOS/Linux
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
> 🔗 Web Interface: `http://localhost:5173`

---

## ⚙️ Environment Variables

### Frontend (`frontend/.env`)
| Variable | Default | คำอธิบาย |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | URL ของ Backend API (dev) |
| `VITE_WS_URL` | `ws://localhost:8000` | WebSocket URL (dev) |

> ในโปรดักชันแอปเรียกแบบ same-origin (`/api`, `/ws`) ผ่าน nginx; WS hook สร้าง URL จาก `location.host` เอง

### Backend (`backend/.env`)
| Variable | Default | คำอธิบาย |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8000` | bind address (uvicorn) |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origins (คั่นด้วยคอมม่า) |
| `DATABASE_URL` | `postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings` | PostgreSQL DSN |
| `JWT_SECRET` | — (บังคับ) | JWT Secret — backend จะไม่ start ถ้าเว้น/เป็นค่า default (<16 ตัว) |
| `ROBOT_IP` / `ROBOT_PORT` | `192.168.10.110` / `29999` | ตัวควบคุม Dobot |
| `BLYNK_TOKEN` | — | Token ของ Blynk (relay) |

### ค่าฮาร์ดแวร์ (`backend/.maps_point.env` — โหลดโดย `maps_point/config.py`, `override=True`)
- **robot / camera:** `ROBOT_IP`, `DEPTH_CAM_SERIAL`, `MIN_DEPTH_MM`, `DEPTH_N_FRAMES`, `DEPTH_ROI`, `CAM_X_SIGN`/`CAM_Y_SIGN`, `CAM_TCP_OFFSET_X/Y`, `WELD_TOOL_INDEX`
- **align:** `ALIGN_GAIN_DEG`, `ALIGN_TOL_DEG`, `ALIGN_MAX_STEPS`, `ALIGN_PROBE_DEG`, `ALIGN_MAX_RMSE_MM`, `ALIGN_RZ_*`
- **draw:** `DRAW_SIMPLIFY_EPS`, `DRAW_MAX_POINTS`, `DRAW_GRID_MAX_ROWS/COLS`, `DRAW_CP_RATIO`, `DRAW_MOTION_MODE`, `DRAW_SERVOP_*`
- **home/surface:** `HOME_X/Y/Z/RX/RY/RZ`, `Z_SURFACE`, `CAM_TIP_OFFSET_MM`, `DRAW_SURFACE_GAP_MM`

> ⚠️ **docker compose `env_file` ฝัง env ตั้งแต่ตอนสร้าง container** — แก้ `.env` แล้ว `docker restart` **ไม่พอ** ต้อง `docker compose up -d --force-recreate backend`

---

## 📡 API Endpoints (ย่อ)

ทุก endpoint ใต้ `/api/*` (ยกเว้น `/api/auth/*`) ต้องมี header `Authorization: Bearer <JWT>`

### 🔑 Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | เข้าสู่ระบบ `{ "username", "password" }` → JWT (72 ชม.) |
| `POST` | `/api/auth/register` | สร้างผู้ใช้ (ต้องล็อกอินก่อน) |
| `GET` | `/api/auth/me` | ข้อมูลผู้ใช้ปัจจุบัน |

### 🤖 Robot / Map (`/api/map`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/map/status` | สถานะหุ่น + กล้อง + joint/tcp + sequence |
| `POST` | `/api/map/connect` `/init` `/camstart` | ต่อหุ่น / ตั้งค่าเริ่มต้น / เปิดกล้อง |
| `POST` | `/api/map/home` | ไปตำแหน่ง home (ใช้ค่า per-user ใน DB) |
| `POST` | `/api/map/goto` `/point` | ย้ายไป / มาร์คจุด (align) |
| `POST` | `/api/map/jog` `/jog_joint` | ขยับ cartesian / joint (reject ถ้า busy) |
| `POST` | `/api/map/align` `/draw` (+ `/stop`) | auto-align / วาดตาม grid |
| `GET` | `/api/map/video_feed` `/pointcloud` `/depth_grid` `/color_frame` | MJPEG / cloud / depth / frame |
| `POST` | `/api/map/emergency` | หยุดฉุกเฉิน (+ ยกเลิก align/draw) |
| `GET`/`POST` | `/api/map/grid/*` `/frame` `/heatmap/toggle` | grid, coordinate frame, heatmap |

### 📹 Camera (`/api/camera`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/camera/stream` `/stream2` | MJPEG กล้องหลัก / รอง (`?mode=rgb|gray|depth`) |
| `GET` | `/api/camera/snapshot` `/snapshot2` | ภาพนิ่ง (`image/jpeg`) |
| `GET` | `/api/camera/devices` | กล้องที่เลือก + รายการที่สแกนได้ |
| `POST` | `/api/camera/scan` `/select` `/swap` | สแกน / เลือกกล้องหลัก / สลับหลัก–รอง |
| `GET`/`POST` | `/api/camera/mode` `/mode2` `/mode/toggle` | โหมดแสดงผลกล้อง 1/2 |
| `GET` | `/api/camera/pointcloud2` `/depth_grid2` | cloud + depth ของกล้องรอง |

### ⚙️ Settings / Devices
| Method | Endpoint | Description |
|---|---|---|
| `GET`/`PUT` | `/api/settings` | settings per-user (home / camera / speed) |
| `POST` | `/api/devices/relay/toggle` | สลับ relay (Blynk) + บันทึก log |
| `GET` | `/api/devices/relay/state` `/relay/history` | สถานะ + ประวัติ relay |
| `GET` | `/api/devices/events` | event log ล่าสุด |
| `POST` | `/api/devices/events/prune` | ตัด event log เก่า |
| `GET` | `/api/devices/ping` | ping สถานะอุปกรณ์ |

### 🔌 WebSocket
| Endpoint | Description |
|---|---|
| `/ws/joints?token=<JWT>` | `{ angles (~20Hz), pose (~10Hz), connected }` |

---

## 🗺️ Frontend Routes & Pages

| Path | หน้า | หน้าที่ |
|---|---|---|
| `/login` | LoginPage | เข้าสู่ระบบ |
| `/dashboard` | DashboardPage | Relay toggle + ping + เมนู |
| `/dobot` | DobotControllerPage | Jog + 3D Viewer + Live Coords |
| `/camera` | CameraViewPage | กล้องสด (2 ตัว) + mode + snapshot |
| `/drawing` | DrawingModePage | สอน grid + วาด + align + teach panel |
| `/settings` | SystemSettingsPage | Robot IP/ports, Home Position, Camera scan/select |

> ทุกหน้า (ยกเว้น `/login`) ถูกป้องกันด้วย `RequireAuth` (ตรวจ JWT ใน localStorage)

---

## 🧩 3D Robot Viewer (`/robot-viewer.html`)

Three.js viewer โหลดโมเดล `.dae` จริง และรองรับ:

| ฟีเจอร์ | วิธีใช้ |
|---|---|
| **IK Drag** | ลากลูกบอลสีส้มที่ปลายแขนเพื่อขยับทุกข้อต่อ (CCD IK) |
| **Translate / Rotate** | กด `Space` สลับโหมด |
| **หมุนกล้อง / Zoom** | คลิกพื้นหลัง + ลาก / Scroll |
| **Live Coords** | ส่ง X/Y/Z/RX/RY/RZ + J1–J6 (interpolated) ไป panel |
| **ควบคุมจาก React** | `iframe.contentWindow.postMessage({ type: 'setJoints', joints: [j1..j6] }, '*')` |

---

## 🧪 การทดสอบ (Testing)

**Automated**

```bash
# Backend (pytest) — มี aiosqlite แทน Postgres จริงในเทสต์
cd backend && python -m pytest

# Frontend (vitest)
cd frontend && npm run test      # หรือ npm run test:watch
```

| ฝั่ง | ชุดทดสอบ |
|---|---|
| Backend | `test_planegrid` (bilinear/grid/validate), `test_config` (env/type), `test_models` (UUID/unique), `test_auth` (JWT/bcrypt/login), `test_floorcalib` (homography), `test_pose_source` (แหล่งข้อมูล pose) |
| Frontend | `lib/api.test.js`, `lib/shapes.test.js`, `lib/robotLogFormat.test.js`, `reportGate.test.js`, `ApiErrorBanner.test.jsx`, `RequireAuth.test.jsx`, `DrawingModePage.smoke.test.jsx` |

**Manual** — ผลทดสอบจริง 150 เคส (102 เคสเดิม + 48 เคสใหม่: Align, Scan, Activity Log, Public Access, Automated Unit Tests) อยู่ใน **[evidence/test_cases_verified.csv](evidence/test_cases_verified.csv)** และ **[TEST_CASES_new.xlsx](TEST_CASES_new.xlsx)**
สเปกฉบับอ่านสะดวกของ 102 เคสแรก — **[TEST_CASES.md](TEST_CASES.md)** · วิธีทดสอบหน้างาน — **[MANUAL_TESTS_ON_SITE.md](MANUAL_TESTS_ON_SITE.md)**

---

## 🧰 Development Commands

```bash
# Lint
cd frontend && npm run lint

# Build production
cd frontend && npm run build

# Preview build
cd frontend && npm run preview

# Docker build เฉพาะ service
docker compose build backend
docker compose build frontend
```

---

## 🚢 Deploy (บน Raspberry Pi)

- Backend เป็น **bind mount** `./backend:/app` → แก้โค้ดแล้ว `docker restart robot_backend` เห็นผลทันที
- Frontend เป็น image baked → build แล้วคัดลอก `dist/index.html` + `dist/assets/` เข้า nginx container
- เปิดให้เข้าถึงจากภายนอกผ่าน **Cloudflare Tunnel** (คอนเทนเนอร์ `cloudflared`) → โดเมน HTTPS ไปยัง nginx

---

## 🛡️ ความปลอดภัย (Security)

1. **Emergency Stop**: HTTP POST ทันทีเมื่อกดปุ่ม E-Stop + ยกเลิก align/draw
2. **Auth**: ทุก `/api/*` ต้องมี JWT (Bearer) — `JWT_SECRET` บังคับตั้งค่าที่แข็งแรง
3. **Move lock**: ทุกคำสั่งเคลื่อนที่ serialize ด้วย `robot_lock` + reject jog ขณะ align/draw/sequence รัน
4. **CORS**: อ่านจาก `ALLOWED_ORIGINS` env — ไม่ hardcode
5. **Secrets**: `.env` / `.maps_point.env` อยู่ใน `.gitignore` — ห้าม commit
6. **PostgreSQL**: bind แค่ `127.0.0.1:5432` (ไม่เปิดออกเน็ต)
7. **Docker**: Multi-stage build — image final ไม่มี Node.js source

---

## 📄 License & Credits

พัฒนาขึ้นสำหรับการเชื่อมต่อและควบคุมหุ่นยนต์แขนกล Dobot CR5 ร่วมกับ Intel RealSense D455 ผ่าน Web Technologies (FastAPI + React + Three.js)
