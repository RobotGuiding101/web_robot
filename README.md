# 🤖 Web Robot — Control Center & Dashboard for Robotic Arm

**Web Robot** คือเว็บแอปพลิเคชันสำหรับควบคุมและติดตามสถานะของหุ่นยนต์แขนกล (Robot Arm / Dobot) แบบเรียลไทม์ผ่านหน้าเว็บแบบ Interactive รองรับการสั่งงาน Jog Control, ดูภาพกล้องสด (Camera Stream), โหมดวาดภาพ (Drawing Mode), และมีระบบคำสั่งหยุดฉุกเฉิน (Emergency Stop) เพื่อความปลอดภัยสูงสุด

---

## 🌟 ฟีเจอร์หลัก (Key Features)

- 🔑 **Authentication (JWT)**
  - Login ด้วย `username` / `password` (bcrypt hash ใน PostgreSQL)
  - ออก token อายุ 72 ชม. — ทุก `/api/*` ต้องแนบ Bearer token (เปิดเฉพาะ `/login`; `/register` และ `/me` ยังต้องมี user)
  - สมัครสมาชิก (`/register`) ต้อง login อยู่ก่อน — ปิด self-registration
- 🎮 **Dobot Controller (การควบคุมหุ่นยนต์)**
  - **Cartesian Control**: ควบคุมตำแหน่งพิกัด X, Y, Z, RX, RY, RZ
  - **Joint Control**: ควบคุมมุมข้อต่อ J1, J2, J3, J4, J5, J6
  - **Step Value Selection**: ปรับระยะการเคลื่อนที่ 0.1, 1, 5, 10 mm/deg
  - **Live Coordinate Readout**: แสดงพิกัดและมุมข้อต่อแบบ Real-time (poll `/api/map/status`)
  - **Move To / Move Sequence**: สั่งไปพิกัดที่กำหนด หรือรันลำดับท่า (หยุดได้กลางคัน)
  - **Home / Clear Error / Connect / Init**: ควบคุมสถานะการเชื่อมต่อหุ่น
  - **3D Model Viewer**: จำลองท่าทางด้วย Three.js r128 + โมเดล `.dae` จริง
  - **IK Drag Control**: ลากลูกบอลปลายแขน (End-Effector) ขยับทุกข้อต่อผ่าน Inverse Kinematics
  - **Live Logs**: ดู log ฝั่ง server และ raw TCP traffic ที่คุยกับหุ่น
- 📹 **Real-Time Camera (Intel RealSense D455)**
  - สตรีมภาพสดแบบ MJPEG (พร้อม overlay จุดที่ mark)
  - สลับโหมดภาพ RGB / Grayscale / Heatmap (depth)
  - สแกนและเลือกกล้อง (device scan/select)
  - บันทึกภาพนิ่ง (Snapshot)
- 🎯 **Align-to-Plane (จัดระนาบอัตโนมัติ)**
  - Mark จุดบนวัตถุ → ระบบ track ด้วย depth region-growing
  - หมุน tool 3 เฟส (probe direction → converge tilt → correct roll) ให้ระนาบตรงวัตถุ
  - บันทึก snapshot + log ทุก step ไว้ที่ `recordings/` เพื่อตรวจย้อนหลัง
- 🎨 **Drawing Mode (โหมดวาดภาพ)**
  - สอน grid N×M บนพื้นผิว (2×2 ถึง 7×7) แล้ว interpolate แบบ bilinear
  - วาดอิสระบน canvas (Fabric.js) → ส่ง trajectory ให้หุ่นวิ่งตามพื้นผิวจริง
  - เลือกโหมดเคลื่อนที่ `cp` (MovL queued + CP blend) หรือ `servo` (ServoP stream)
- 🔌 **Device / Relay Control**
  - สั่งเปิด-ปิด relay ผ่าน Blynk (`V1`), เก็บประวัติการ toggle ลง DB
  - Ping ตรวจสอบการเข้าถึงหุ่น (`/api/devices/ping`)
- 📊 **Dashboard**
  - ภาพรวมสถานะการเชื่อมต่อ, relay state/history, ทางลัดไปหน้าต่างๆ
- 🚨 **Safety & Emergency Stop**
  - ปุ่ม E-Stop อยู่บน TopBar ทุกหน้า — ยิงพร้อมกัน 3 คำสั่ง (`map/emergency`, `robot/emergency-stop`, `map/move_sequence/stop`)
- ⚙️ **System Settings**
  - ตั้งค่า Robot IP, สแกน/เลือกกล้อง, ทดสอบการเชื่อมต่อ
  - ปรับความเร็ว (speed) จาก Sidebar และบันทึกลง DB
- 📱 **iPad-First Responsive Design**
  - รองรับ Desktop, iPad (768–1024px), และ Mobile (bottom nav)

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

### **Frontend**
| เทคโนโลยี | เวอร์ชัน | หน้าที่ |
|---|---|---|
| [React](https://react.dev/) | ^19.2 | UI Framework |
| [Vite](https://vitejs.dev/) | ^8.1 | Build Tool & Dev Server |
| [React Router DOM](https://reactrouter.com/) | ^7.18 | Client-side Routing |
| [Fabric.js](https://fabricjs.com/) | ^7.4 | Canvas วาดอิสระใน Drawing Mode |
| [Three.js](https://threejs.org/) | r128 (CDN) | 3D Robot Model Viewer (ใน `robot-viewer.html`) |
| Vanilla CSS | — | Design System, Dark UI, Glassmorphism |
| [Oxlint](https://oxc.rs/) | ^1.71 | Linting |

### **Backend**
| เทคโนโลยี | หน้าที่ |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Python Web Framework |
| [Uvicorn](https://www.uvicorn.org/) | ASGI Server (`uvicorn[standard]`) |
| [SQLAlchemy](https://www.sqlalchemy.org/) (async) + [asyncpg](https://github.com/MagicStack/asyncpg) | ORM / PostgreSQL driver |
| [python-jose](https://python-jose.readthedocs.io/) + [passlib[bcrypt]](https://passlib.readthedocs.io/) | JWT + password hashing |
| [OpenCV](https://opencv.org/) (headless) + [NumPy](https://numpy.org/) | Vision / depth processing |
| [pyrealsense2](https://pypi.org/project/pyrealsense2/) | Intel RealSense D455 capture |
| [python-dotenv](https://pypi.org/project/python-dotenv/) / python-multipart | Env vars / form parsing |

### **Infrastructure**
| เทคโนโลยี | หน้าที่ |
|---|---|
| Docker + Docker Compose | Container Orchestration |
| [PostgreSQL 16](https://www.postgresql.org/) (alpine) | เก็บ users / settings / device logs |
| nginx (Alpine) | Static File Serving + API/MJPEG Proxy |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | เข้าถึงจากภายนอกโดยไม่ต้อง port-forward |

---

## 📂 โครงสร้างโปรเจกต์ (Project Structure)

```text
web_robot/
├── README.md
├── docker-compose.yml              # รัน Frontend + Backend + PostgreSQL ด้วยคำสั่งเดียว
│
├── backend/                        # FastAPI Server (port 8000)
│   ├── main.py                     # App entry: lifespan, auth middleware, CORS, include routers, root()
│   ├── database.py                 # async SQLAlchemy engine + Base
│   ├── models.py                   # ORM: User, UserSetting, DeviceLog
│   ├── requirements.txt            # Python dependencies
│   ├── run.bat                     # Windows run script
│   ├── .env / .env.example         # env หลัก (auth, DB, CORS) — .env ไม่ commit
│   ├── .maps_point.env(.example)   # env ของ maps_point (robot/camera/align/draw)
│   ├── Dockerfile / .dockerignore
│   │
│   ├── routers/                    # HTTP layer (FastAPI)
│   │   ├── auth.py                 # /api/auth — register, login, me (JWT)
│   │   ├── settings.py             # /api/settings — GET/PUT settings (per-key)
│   │   ├── robot.py                # /api/robot — move, emergency-stop, draw, status
│   │   ├── camera.py               # /api/camera — mode, devices, scan, select, stream, snapshot
│   │   ├── devices.py              # /api/devices — relay toggle/state/history, ping robot
│   │   └── mapcontrol.py           # /api/map — bridge ไป maps_point (align/draw/jog/grid/status/logs)
│   │
│   └── maps_point/                 # Hardware-control core (Dobot CR5 + RealSense D455)
│       ├── config.py               # โหลด .maps_point.env → ค่าคงที่ทั้งหมด (robot/camera/align/draw)
│       ├── robot.py                # Robot — connect/init, movl/movj/joint_movj, jog, servo, path, E-stop
│       ├── camera.py               # Camera — capture thread, depth/color, sample_plane_region_grow
│       ├── dobot_api_v3.py         # Vendored Dobot TCP SDK (Dashboard/Move command builders)
│       ├── motion.py               # cam_xy_to_robot, pixel_to_world_xy, goto_pixel, do_goto
│       ├── align.py                # AppState + 3-phase align loop (probe/converge/roll) + tracker thread
│       ├── planegrid.py            # N×M grid calibration + freehand stroke → path (bilinear)
│       ├── render.py               # draw_overlay — วาด overlay บนเฟรม (live + recording ใช้ร่วม)
│       ├── recording.py            # AlignRecorder — snapshot + log ต่อ run
│       ├── logs.py                 # ring buffers: log()/robot_log() + server_ring/robot_ring
│       └── __init__.py
│
└── frontend/                       # React + Vite (dev 5173 / prod 80)
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── nginx.conf                  # proxy /api/* → backend, serve static
    ├── .oxlintrc.json              # Oxlint config
    ├── .env / .env.example         # env (VITE_API_URL, VITE_WS_URL) — .env ไม่ commit
    ├── Dockerfile / .dockerignore  # Multi-stage: Node build → nginx serve
    ├── public/
    │   ├── robot-viewer.html       # Three.js 3D viewer (iframe + postMessage)
    │   ├── favicon.svg / icons.svg
    │   ├── assets/images/          # ไอคอนเมนู (home, camera, drawing, 3d-cube, robot-arm, settings)
    │   └── models/                 # โมเดล .dae/.glb (base_link, Link1–6, testLink, testV2)
    └── src/
        ├── main.jsx                # React root
        ├── App.jsx                 # Routes + RequireAuth + ApiErrorBanner + global camera dock
        ├── index.css               # Global design system
        ├── lib/
        │   └── api.js              # getToken/clearToken/isTokenValid/redirectToLogin/authHeaders/apiFetch
        ├── components/
        │   ├── Sidebar.jsx         # เมนู + speed control + logout (NavItem, LogoutIcon)
        │   ├── TopBar.jsx          # header + ปุ่ม E-Stop
        │   ├── CameraStream.jsx    # MJPEG stream dock (setStreamMode, seq reassembly)
        │   ├── RequireAuth.jsx     # route guard
        │   └── ApiErrorBanner.jsx  # แบนเนอร์แจ้ง error 500
        └── pages/
            ├── LoginPage.jsx
            ├── DashboardPage.jsx
            ├── DobotControllerPage.jsx  # jog + 3D viewer + live coords (JogGroup, LogPanel)
            ├── CameraViewPage.jsx
            ├── DrawingModePage.jsx      # canvas + grid calibration + replay
            ├── SystemSettingsPage.jsx   # API/IP/camera settings (SettingsRow, Section)
            └── CalibrationPage.jsx      # หน้า calibration (Crosshair, StepList) — ยังไม่ผูกใน App.jsx
```

### 🔧 ฟังก์ชันหลักของแต่ละโมดูล (Module Functions)

#### `backend/maps_point/` — Hardware-control core

| โมดูล | ฟังก์ชัน / คลาส |
|---|---|
| `robot.py` | `Robot` (`connect`, `init_robot`, `set_frame`, `get_pose`, `get_mode`, `movl`, `movj`, `joint_movj`, `set_cp`, `movl_queued`, `movl_path`, `servo_p`, `servo_stream`, `rel_movl_tool`, `jog_cartesian`, `jog_joint`, `get_angle`, `go_home`, `disable_robot`, `clear_error`, `emergency_stop`, `_wait_stable`), `RobotMoveError`, `_reply_error_code` |
| `camera.py` | `Camera` (`start`, `stop`, `set_serial`, `_capture_loop`, `get_latest_accel`, `get_latest_frame`, `get_latest_frames_ref`, `get_latest_color`, `_wait_depth_buf`, `sample_depth`, `sample_plane_region_grow`), `list_devices`, `_list_devices_rs` |
| `motion.py` | `cam_xy_to_robot`, `pixel_to_world_xy`, `goto_pixel`, `do_goto` |
| `align.py` | `AppState`, `do_align`, `start_tracking_thread`, `_continuous_tracking_loop`, `_region_grow_measure`, `_wait_tracking_ok`, `_probe_align_sign`, `_recenter_xy`, `_finish_centered`, `_converge_rz` |
| `planegrid.py` | `bilinear_cell`, `grid_pose`, `_fit_plane`, `validate_grid`, `project_grid_2d`, `_cap_points`, `simplify_stroke`, `densify_path`, `_stroke_to_poses`, `_assemble_strokes`, `do_draw` |
| `render.py` | `draw_overlay` |
| `recording.py` | `AlignRecorder` (`log`, `snap`) |
| `logs.py` | `log`, `robot_log`, `_RingLog` (`write`, `since`), `server_ring`, `robot_ring` |
| `config.py` | ค่าคงที่ทั้งหมด (โหลดจาก `.maps_point.env`): `ROBOT_IP`, `MOVE_SPEED`, `CAM_*`, `HOME_*`, `ALIGN_*`, `DRAW_*` |
| `dobot_api_v3.py` | Vendored Dobot TCP SDK — `DobotApi`, `DobotApiDashboard` (`EnableRobot`, `DisableRobot`, `ClearError`, `SpeedFactor`, `GetAngle`, `GetPose`, `EmergencyStop`, `RobotMode`, …), `DobotApiMove` (`MovJ`, `MovL`, `JointMovJ`, `RelMovJTool`, `RelMovLTool`, `ServoP`, `MoveJog`, …), `alarmAlarmJsonFile` |

#### `backend/routers/` — HTTP endpoints

| ไฟล์ | Endpoints |
|---|---|
| `auth.py` | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| `settings.py` | `GET /api/settings`, `PUT /api/settings`, `PUT /api/settings/{key}` |
| `robot.py` | `POST /api/robot/move`, `POST /api/robot/emergency-stop`, `POST /api/robot/draw`, `GET /api/robot/status` |
| `camera.py` | `GET/POST /api/camera/mode`, `POST /api/camera/mode/toggle`, `GET /api/camera/devices`, `POST /api/camera/scan`, `POST /api/camera/select`, `GET /api/camera/stream`, `GET /api/camera/snapshot` |
| `devices.py` | `POST /api/devices/relay/toggle`, `GET /api/devices/relay/state`, `GET /api/devices/relay/history`, `GET /api/devices/ping` |
| `mapcontrol.py` | `/api/map/` — `video_feed`, `connect`, `init`, `camstart`, `error`, `emergency`, `home`, `point`, `goto`, `reset_points`, `heatmap/toggle`, `camera_mode` (GET/POST), `camera_mode/toggle`, `jog`, `jog_joint`, `move_to`, `move_sequence`, `move_sequence/stop`, `frame`, `align`, `align/stop`, `grid/size`, `grid/mark`, `grid/autofill`, `grid/setz`, `grid/surfacez`, `grid/reset`, `draw`, `draw/stop`, `status`, `logs`, `robot_logs`, `cli` |

#### `backend/` — App & data layer

| ไฟล์ | ฟังก์ชัน / คลาส |
|---|---|
| `main.py` | `lifespan` (auto-start camera + robot connect), `require_bearer_token` middleware, `root` |
| `database.py` | `engine`, `Base`, `get_db` |
| `models.py` | `User`, `UserSetting`, `DeviceLog`, `_utcnow` |

#### `frontend/src/` — UI

| ไฟล์ | ฟังก์ชัน / คอมโพเนนต์ |
|---|---|
| `lib/api.js` | `decodePayload`, `getToken`, `clearToken`, `isTokenValid`, `redirectToLogin`, `authHeaders`, `apiFetch` |
| `components/Sidebar.jsx` | `Sidebar`, `NavItem`, `LogoutIcon`, `authHeaders` |
| `components/TopBar.jsx` | `TopBar` |
| `components/CameraStream.jsx` | `CameraStream`, `setStreamMode`, `findSeq`, `concat` |
| `components/RequireAuth.jsx` | `RequireAuth` |
| `components/ApiErrorBanner.jsx` | `ApiErrorBanner` |
| `pages/LoginPage.jsx` | `LoginPage` |
| `pages/DashboardPage.jsx` | `DashboardPage` (+ icon components) |
| `pages/DobotControllerPage.jsx` | `DobotControllerPage`, `JogGroup`, `LogPanel`, `SectionHead` |
| `pages/CameraViewPage.jsx` | `CameraViewPage` |
| `pages/DrawingModePage.jsx` | `DrawingModePage`, `getCanvasPathData`, `clampInt` |
| `pages/SystemSettingsPage.jsx` | `SystemSettingsPage`, `SettingsRow`, `Section`, `StatusBadge` |
| `pages/CalibrationPage.jsx` | `CalibrationPage`, `Crosshair`, `StepList` (ยังไม่ผูกใน `App.jsx`) |

---

## 🏗️ สถาปัตยกรรมระบบ (System Architecture)

```mermaid
graph TD
    User([ผู้ใช้งาน / Operator]) -->|HTTPS| CF["☁️ Cloudflare Tunnel<br/>(cloudflared)"]
    CF --> Frontend["Frontend — nginx :80<br/>React 19 + Vite + Three.js<br/>(dev: 5173)"]
    Frontend <-->|iframe postMessage| Viewer["3D Robot Viewer<br/>/robot-viewer.html"]
    Frontend <-->|REST API + JWT| Backend["Backend — FastAPI :8000<br/>uvicorn"]
    Backend <-->|SQLAlchemy async| DB[("🐘 PostgreSQL 16<br/>users / settings / device_logs")]
    Backend <-->|maps_point: TCP 29999 + 30003| Dobot[🤖 Dobot CR5<br/>192.168.10.110]
    Backend <-->|pyrealsense2 → MJPEG| Camera[📹 Intel RealSense D455]
    Backend <-->|HTTP relay| Devices[🔌 Relay / Blynk Devices]
```

> **Backend internals**: ชั้น HTTP อยู่ที่ `routers/` (`auth`, `settings`, `robot`, `camera`, `devices`, `mapcontrol`) — ส่วนตรรกะควบคุมฮาร์ดแวร์ทั้งหมดอยู่ใน `maps_point/` (`robot` = Dobot TCP, `camera` = RealSense + depth, `align` = 3-phase alignment + tracker, `planegrid` = grid/draw, `motion`, `render`, `recording`, `logs`)

> **Auth flow**: ทุก request ไป `/api/*` (ยกเว้น `/api/auth/*`) ผ่าน `require_bearer_token` middleware ตรวจ JWT ก่อนถึง router

---

## 🚀 การติดตั้งและการใช้งาน (Setup)

### 📋 ความต้องการของระบบ (Prerequisites)

#### แบบ Docker (แนะนำ)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) v24+

#### แบบ Manual
- **Node.js** v18+
- **Python** 3.10+
- **Git**

---

## 🐳 วิธีรันด้วย Docker (แนะนำ)

```bash
# 1. Clone โปรเจกต์
git clone <repo-url>
cd web_robot

# 2. สร้างไฟล์ .env จาก template
cp backend/.env.example backend/.env
cp backend/.maps_point.env.example backend/.maps_point.env
cp frontend/.env.example frontend/.env

# 3. Build และรัน
docker compose up --build

# รัน background
docker compose up -d --build

# ดู logs
docker compose logs -f

# หยุด
docker compose down
```

| Service | Container | URL / Port |
|---|---|---|
| 🌐 **Frontend** (nginx) | `robot_frontend` | http://localhost :80 |
| 🔌 **Backend API** (FastAPI) | `robot_backend` | http://localhost:8000 |
| 📑 **Swagger Docs** | — | http://localhost:8000/docs |
| 🐘 **PostgreSQL** | `robot_postgres` | `localhost:5432` (`robot_settings`) |

> **หมายเหตุ**:
> - `backend` และ `frontend` ใช้ `network_mode: host` — nginx proxy `/api/*` (รวม MJPEG ที่ปิด buffering) ไปที่ backend
> - ต้องมี `backend/.maps_point.env` (ค่ากล้อง/หุ่น/home) ไม่งั้นใช้ค่า default ใน `config.py`
> - `backend` ต้อง `privileged: true` เพื่อเข้าถึงกล้อง RealSense/USB

---

## 🛠️ วิธีรันแบบ Manual (Development)

### 1️⃣ Backend (FastAPI)

```bash
cd backend

# สร้าง Virtual Environment
python -m venv venv

# เปิดใช้งาน venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# ติดตั้ง dependencies
pip install -r requirements.txt

# สร้างไฟล์ .env
cp .env.example .env
# แก้ไขค่าตามสภาพแวดล้อม

# รัน server
.\run.bat               # Windows
# หรือ
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

> 🌐 **API**: `http://localhost:8000`  
> 📑 **Swagger UI**: `http://localhost:8000/docs`

---

### 2️⃣ Frontend (React + Vite)

```bash
cd frontend

# ติดตั้ง dependencies
npm install

# สร้างไฟล์ .env
cp .env.example .env

# รัน dev server
npm run dev
```

> 🔗 **Web Interface**: `http://localhost:5173`

---

## ⚙️ Environment Variables

### Frontend (`frontend/.env`)

| Variable | Default | คำอธิบาย |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | URL ของ Backend API (declared — โค้ดจริงเรียก path relative `/api/...` แล้วพึ่ง nginx proxy) |
| `VITE_WS_URL` | `ws://localhost:8000` | WebSocket URL (declared — ยังไม่มี WS endpoint ฝั่ง backend) |

> ⚠️ ปัจจุบัน frontend เรียก `/api/...` แบบ relative เสมอ (nginx/vite proxy ไป backend) — `VITE_API_URL` / `VITE_WS_URL` เป็นค่าที่เตรียมไว้ ยังไม่ถูกอ้างในโค้ด

### Backend (`backend/.env`)

| Variable | Default | คำอธิบาย |
|---|---|---|
| `HOST` | `0.0.0.0` | Host ที่ bind (uvicorn อ่านจาก compose command) |
| `PORT` | `8000` | Port ของ server |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS Origins (คั่นด้วยคอมม่า) |
| `DATABASE_URL` | `postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings` | PostgreSQL DSN |
| `ROBOT_IP` | `192.168.10.110` | IP ของตัวควบคุม Dobot |
| `ROBOT_PORT` | `29999` | Port ของ Dobot (declared — โค้ดใช้ 29999 dashboard + 30003 move แบบ hardcode) |
| `JWT_SECRET` | `robot-arm-secret-change-me` | JWT Secret Key (auth.py อ่านตัวนี้) |
| `BLYNK_TOKEN` | — | Token ของ Blynk (relay) |

> **ค่าของ robot / camera / align / draw** (เช่น `ROBOT_IP` default, `DEPTH_CAM_SERIAL`, `HOME_*`, `MOVE_SPEED`, `ALIGN_*`, `DRAW_*`) โหลดจาก `backend/.maps_point.env` โดย `maps_point/config.py` (`override=True`)

<details>
<summary>ตัวแปรสำคัญใน <code>backend/.maps_point.env</code></summary>

| กลุ่ม | ตัวแปร |
|---|---|
| Robot | `ROBOT_IP`, `Z_CALIB_SPEED` |
| Camera | `DEPTH_CAM_SERIAL`, `DEPTH_N_FRAMES`, `DEPTH_ROI`, `MIN_DEPTH_MM`, `CAM_X_SIGN`, `CAM_Y_SIGN`, `CAM_TCP_OFFSET_X/Y` |
| Align | `WELD_TOOL_INDEX`, `ALIGN_GAIN_DEG`, `ALIGN_TOL_DEG`, `ALIGN_MAX_STEPS`, `ALIGN_PROBE_DEG`, `ALIGN_*` |
| Draw | `DRAW_SIMPLIFY_EPS`, `DRAW_MAX_POINTS`, `DRAW_GRID_MAX_ROWS/COLS`, `DRAW_MOTION_MODE` (`cp`/`servo`), `DRAW_CP_RATIO`, `DRAW_SERVOP_*`, `DRAW_LIFT_MM` |
| Home | `HOME_X/Y/Z`, `HOME_RX/RY/RZ` |

> ดูรายละเอียด/คอมเมนต์ครบใน `backend/.maps_point.env.example`
</details>

> ⚠️ **docker compose `env_file` ฝัง env ตั้งแต่ตอนสร้าง container** — แก้ `.env` แล้ว `docker restart` **ไม่พอ** ต้อง `docker compose up -d --force-recreate backend` ไม่งั้นค่าเก่ายังค้าง (เช่น `ROBOT_IP` เก่าทำให้ต่อหุ่นไม่ได้ + ค้างที่ SYN-SENT)

---

## 📡 API Endpoints

> ทุก endpoint ใต้ `/api/*` (ยกเว้น `/api/auth/register` และ `/api/auth/login`) ต้องแนบ header `Authorization: Bearer <token>`

### 🔑 Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | สร้างบัญชีใหม่ (ต้อง login อยู่ก่อน) |
| `POST` | `/api/auth/login` | เข้าสู่ระบบ `{ "username", "password" }` → `{ access_token, username }` |
| `GET` | `/api/auth/me` | ข้อมูลผู้ใช้ปัจจุบัน |

### ⚙️ Settings (`/api/settings`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings` | ดึง settings ทั้งหมดของผู้ใช้ |
| `PUT` | `/api/settings` | อัปเดตหลายค่า `{ settings: [{ key, value }] }` |
| `PUT` | `/api/settings/{key}` | อัปเดตค่าเดียว |

### 🤖 Robot Control — legacy (`/api/robot`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/robot/status` | ดึงพิกัดและมุมข้อต่อปัจจุบัน |
| `POST` | `/api/robot/move` | ขยับ `{ "axis": "X", "direction": "+", "step": 1.0 }` |
| `POST` | `/api/robot/emergency-stop` | หยุดฉุกเฉินทันที |
| `POST` | `/api/robot/draw` | ส่ง Trajectory วาดภาพ |

### 📹 Camera (`/api/camera`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` / `POST` | `/api/camera/mode` | อ่าน / ตั้งค่าโหมดภาพ (rgb/gray) |
| `POST` | `/api/camera/mode/toggle` | สลับโหมดภาพ |
| `GET` | `/api/camera/devices` | ลิสต์กล้องที่พบ |
| `POST` | `/api/camera/scan` | สแกนหากล้องใหม่ |
| `POST` | `/api/camera/select` | เลือกกล้องตาม serial |
| `GET` | `/api/camera/stream` | MJPEG Video Stream |
| `GET` | `/api/camera/snapshot` | ดึงภาพนิ่ง (`image/jpeg`) |

### 🔌 Devices (`/api/devices`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/devices/relay/toggle` | สลับ relay V1 (ผ่าน Blynk) + log ลง DB |
| `GET` | `/api/devices/relay/state` | สถานะ relay ปัจจุบัน |
| `GET` | `/api/devices/relay/history` | ประวัติการ toggle (50 รายการล่าสุด) |
| `GET` | `/api/devices/ping` | Ping ตรวจสอบการเข้าถึงหุ่น (`192.168.10.110`) |

### 🗺️ MapControl — ศูนย์ควบคุมหลัก (`/api/map`)
| กลุ่ม | Method | Endpoint | Description |
|---|---|---|---|
| **Connection** | `POST` | `/api/map/connect` | เชื่อมต่อหุ่น |
| | `POST` | `/api/map/init` | Enable + ตั้ง tool/user frame |
| | `POST` | `/api/map/camstart` | เริ่มกล้อง |
| | `POST` | `/api/map/error` | Clear error ของหุ่น |
| | `POST` | `/api/map/home` | กลับ home position |
| | `POST` | `/api/map/emergency` | หยุดฉุกเฉิน (ฝั่ง maps_point) |
| **Stream / Status** | `GET` | `/api/map/video_feed` | MJPEG stream + overlay |
| | `GET` | `/api/map/status` | สถานะรวม (connected / camera / pose / tracking) |
| | `GET` | `/api/map/logs` | Server log (ring buffer) |
| | `GET` | `/api/map/robot_logs` | Raw TCP traffic กับหุ่น |
| | `POST` | `/api/map/frame` | ตั้ง tool/user frame |
| | `POST` | `/api/map/cli` | ส่งคำสั่ง raw ไปหุ่น |
| **Align** | `POST` | `/api/map/point` | Mark จุดอ้างอิง |
| | `POST` | `/api/map/goto` | เลื่อนไปยังจุดที่ mark |
| | `POST` | `/api/map/reset_points` | ล้างจุดที่ mark |
| | `POST` | `/api/map/align` | เริ่ม align-to-plane |
| | `POST` | `/api/map/align/stop` | หยุด align |
| **Camera mode** | `GET` / `POST` | `/api/map/camera_mode` | อ่าน / ตั้งค่าโหมดภาพ |
| | `POST` | `/api/map/camera_mode/toggle` | สลับโหมดภาพ |
| | `POST` | `/api/map/heatmap/toggle` | เปิด/ปิด heatmap (depth) |
| **Jog / Move** | `POST` | `/api/map/jog` | Jog แบบ Cartesian |
| | `POST` | `/api/map/jog_joint` | Jog แบบ joint |
| | `POST` | `/api/map/move_to` | ไปพิกัดที่กำหนด |
| | `POST` | `/api/map/move_sequence` | รันลำดับท่า |
| | `POST` | `/api/map/move_sequence/stop` | หยุดลำดับท่า |
| **Grid / Draw** | `POST` | `/api/map/grid/size` | ตั้งขนาด grid (rows × cols) |
| | `POST` | `/api/map/grid/mark` | บันทึกมุม grid |
| | `POST` | `/api/map/grid/autofill` | เติม grid ที่เหลือ |
| | `POST` | `/api/map/grid/setz` | ตั้งค่า Z ของ grid |
| | `POST` | `/api/map/grid/surfacez` | วัด Z พื้นผิวอัตโนมัติ |
| | `POST` | `/api/map/grid/reset` | ล้าง grid |
| | `POST` | `/api/map/draw` | ส่ง stroke ให้หุ่นวาด |
| | `POST` | `/api/map/draw/stop` | หยุดการวาด |

> 📑 ดู Swagger UI แบบครบถ้วนได้ที่ `http://localhost:8000/docs`

---

## 🗺️ Frontend Routes

| Path | หน้าที่ | Auth |
|---|---|---|
| `/` | redirect → `/login` | — |
| `/login` | หน้า Login (Glassmorphism UI) | — |
| `/dashboard` | ภาพรวมสถานะระบบ + relay control | ✅ |
| `/dobot` | ควบคุม Jog + 3D Viewer + Live Coords + Logs | ✅ |
| `/camera` | กล้องสด + สลับโหมดภาพ + Snapshot | ✅ |
| `/drawing` | Align-to-plane + Grid calibration + วาดภาพ | ✅ |
| `/settings` | ตั้งค่า Robot IP / กล้อง / การเชื่อมต่อ | ✅ |

> ทุกหน้า (ยกเว้น `/login`) ถูกครอบด้วย `RequireAuth` — ตรวจ token ก่อนเข้า
>
> ℹ️ `CalibrationPage.jsx` มีอยู่ในโค้ดแต่**ยังไม่ถูกผูก route** ใน `App.jsx`

---

## 🧩 3D Robot Viewer (`/robot-viewer.html`)

Three.js **r128** (โหลดจาก CDN) + `ColladaLoader` โหลดโมเดล `.dae` จริง (base_link + Link1–6) และวางเป็น iframe ในหน้า Dobot Controller

| ฟีเจอร์ | วิธีใช้ |
|---|---|
| **IK Drag** | ลากลูกบอลสีส้ม 🟠 ที่ปลายแขนเพื่อขยับทุกข้อต่อ (Inverse Kinematics) |
| **Translate / Rotate** | กด `Space` สลับ gizmo (TransformControls) |
| **Ghost Poses** | แสดงท่าที่บันทึกไว้ (ghost) เทียบกับท่าปัจจุบัน |
| **หมุนกล้อง / Zoom** | คลิกพื้นหลัง + ลาก (OrbitControls) / Scroll |
| **Live Coords** | ส่งพิกัด TCP + มุมข้อต่อไปยัง Control Panel ผ่าน `postMessage` |

**Message protocol** (ระหว่าง React ↔ iframe):

| ทิศทาง | `type` | ข้อมูล |
|---|---|---|
| React → Viewer | `setJoints` | `joints: [j1..j6]` (องศา), `realPose` |
| React → Viewer | `snapGhost` / `clearGhost` / `clearAllGhosts` / `removeLastGhost` / `restoreGhost` / `selectGhost` / `highlightGhost` / `deleteGhost` | จัดการ ghost pose (`index`) |
| Viewer → React | `targetPoseUpdate` / `tcpUpdate` | พิกัด TCP ที่อัปเดต |
| Viewer → React | `ghostListUpdate` / `ghostCleared` / `gizmoDragStart` | สถานะ ghost / เริ่มลาก gizmo |

---

## 🧪 Development Commands

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

## 🛡️ ความปลอดภัย (Security)

1. **Emergency Stop**: ปุ่ม E-Stop บน TopBar ยิงพร้อมกัน `map/emergency`, `robot/emergency-stop`, `map/move_sequence/stop`
2. **Auth ทุก API**: middleware `require_bearer_token` ตรวจ JWT ก่อนถึง router — ยกเว้น `/api/auth/login`, `/api/auth/register`
3. **Password**: hash ด้วย bcrypt (`passlib`) — ไม่เก็บ plaintext
4. **Registration ปิด**: `/api/auth/register` ต้อง login อยู่ก่อน (กันคนนอกสร้างบัญชีมาคุมหุ่น)
5. **CORS**: อ่านจาก `ALLOWED_ORIGINS` env — ไม่ hardcode
6. **Secrets**: `.env`, `.maps_point.env` อยู่ใน `.gitignore` — ห้าม commit
7. **Docker**: Multi-stage build — image final ไม่มี Node.js source

---

## 📄 License & Credits

พัฒนาขึ้นสำหรับการเชื่อมต่อและควบคุมหุ่นยนต์แขนกล Dobot ผ่าน Web Technologies (FastAPI + React + Three.js)
