# 🤖 Web Robot — Control Center & Dashboard for Robotic Arm

**Web Robot** คือเว็บแอปพลิเคชันสำหรับควบคุมและติดตามสถานะของหุ่นยนต์แขนกล (Robot Arm / Dobot) แบบเรียลไทม์ผ่านหน้าเว็บแบบ Interactive รองรับการสั่งงาน Jog Control, ดูภาพกล้องสด (Camera Stream), โหมดวาดภาพ (Drawing Mode), และมีระบบคำสั่งหยุดฉุกเฉิน (Emergency Stop) เพื่อความปลอดภัยสูงสุด

---

## 🌟 ฟีเจอร์หลัก (Key Features)

- 🎮 **Dobot Controller (การควบคุมหุ่นยนต์)**
  - **Cartesian Control**: ควบคุมตำแหน่งพิกัด X, Y, Z, RX, RY, RZ
  - **Joint Control**: ควบคุมมุมข้อต่อ J1, J2, J3, J4, J5, J6
  - **Step Value Selection**: ปรับระยะการเคลื่อนที่ตั้งแต่ 0.1, 1, 5, ถึง 10 mm/deg
  - **Live Coordinate Readout**: แสดงพิกัดปัจจุบัน X/Y/Z/RX/RY/RZ และมุม J1–J6 แบบ Real-time
  - **3D Model Viewer**: จำลองท่าทางหุ่นยนต์ด้วย Three.js + โมเดล `.dae` จริง
  - **IK Drag Control**: ลากจุดปลายแขน (End-Effector) เพื่อขยับหุ่นยนต์ผ่าน CCD Inverse Kinematics
- 📹 **Real-Time Camera Stream**
  - สตรีมภาพวิดีโอสดจากกล้อง (MJPEG Stream)
  - รองรับการบันทึกภาพนิ่ง (Snapshot Capture)
- 🎨 **Drawing Mode (โหมดวาดภาพ)**
  - สร้างและส่ง Trajectory การวาดภาพไปยังแขนกล
- 🚨 **Safety & Emergency Stop**
  - ปุ่มหยุดฉุกเฉิน (E-Stop) เข้าถึงได้จากทุกหน้า
- 📊 **Dashboard & Analytics**
  - แสดงภาพรวมสถานะการเชื่อมต่อและการทำงานของระบบ
- ⚙️ **System Settings**
  - ตั้งค่าการเชื่อมต่อ API, Serial/TCP Port, และกล้อง
- 📱 **iPad-First Responsive Design**
  - รองรับ Desktop, iPad (768–1024px), และ Mobile

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

### **Frontend**
| เทคโนโลยี | เวอร์ชัน | หน้าที่ |
|---|---|---|
| [React](https://react.dev/) | 19 | UI Framework |
| [Vite](https://vitejs.dev/) | 8 | Build Tool & Dev Server |
| [React Router DOM](https://reactrouter.com/) | v7 | Client-side Routing |
| [Three.js](https://threejs.org/) | r128 | 3D Robot Model Viewer |
| Vanilla CSS | — | Design System, Dark UI, Glassmorphism |
| [Oxlint](https://oxc.rs/) | — | Linting |

### **Backend**
| เทคโนโลยี | หน้าที่ |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Python Web Framework |
| [Uvicorn](https://www.uvicorn.org/) | ASGI Server |
| [python-dotenv](https://pypi.org/project/python-dotenv/) | Environment Variables |
| Pydantic | Data Validation |

### **Infrastructure**
| เทคโนโลยี | หน้าที่ |
|---|---|
| Docker + Docker Compose | Container Orchestration |
| nginx (Alpine) | Static File Serving + API Proxy |

---

## 📂 โครงสร้างโปรเจกต์ (Project Structure)

```text
web_robot/
├── README.md
├── DATABASE.md                   # ER diagram + schema ฐานข้อมูล
├── docker-compose.yml            # รัน Frontend + Backend ด้วยคำสั่งเดียว
│
├── backend/                      # FastAPI Server
│   ├── main.py                   # App entry point & CORS config
│   ├── requirements.txt          # Python dependencies
│   ├── run.bat                   # Windows run script
│   ├── .env                      # Environment variables (ไม่ commit)
│   ├── .env.example              # Template (commit ได้)
│   ├── Dockerfile
│   ├── .dockerignore
│   └── routers/
│       ├── auth.py               # /api/auth — Login/Logout
│       ├── camera.py             # /api/camera — Stream & Snapshot
│       └── robot.py              # /api/robot — Move, Status, E-Stop
│
└── frontend/                     # React + Vite Web App
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── nginx.conf                # nginx config สำหรับ Docker
    ├── .env                      # Environment variables (ไม่ commit)
    ├── .env.example              # Template (commit ได้)
    ├── Dockerfile                # Multi-stage: Node build → nginx serve
    ├── .dockerignore
    └── src/
        ├── App.jsx               # Routing
        ├── main.jsx
        ├── index.css             # Global Design System
        ├── components/
        │   ├── Sidebar.jsx
        │   └── TopBar.jsx
        └── pages/
            ├── LoginPage.jsx
            ├── DashboardPage.jsx
            ├── DobotControllerPage.jsx
            ├── CameraViewPage.jsx
            ├── DrawingModePage.jsx
            └── SystemSettingsPage.jsx
    └── public/
        ├── robot-viewer.html     # Three.js 3D Robot Viewer (iframe)
        └── models/               # โมเดล .dae ของหุ่นยนต์
            ├── base_link.dae
            ├── Link1.dae … Link6.dae
```

---

## 🏗️ สถาปัตยกรรมระบบ (System Architecture)

```mermaid
graph TD
    User([ผู้ใช้งาน / Operator]) <--> Frontend["Frontend React Web App\n(Port 80 — Docker / 5173 — Dev)"]
    Frontend <-->|iframe postMessage| Viewer["Three.js 3D Viewer\n/robot-viewer.html"]
    Frontend <-->|REST API| Backend["Backend FastAPI\n(Port 8000)"]
    Backend <-->|SDK / Serial / TCP| Dobot[🤖 Dobot Robot Arm]
    Backend <-->|OpenCV / MJPEG| Camera[📹 Camera Device]
```

---

## 🗄️ โครงสร้างฐานข้อมูล (Database)

PostgreSQL 16 — 3 ตาราง: `users`, `user_settings`, `device_logs` (สร้างอัตโนมัติจาก SQLAlchemy `Base.metadata` ตอน startup)

> 📑 ดู **ER Diagram** + รายละเอียด schema/คอลัมน์/ความสัมพันธ์ทั้งหมดที่ **[DATABASE.md](DATABASE.md)**

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

| Service | URL |
|---|---|
| 🌐 **Frontend** | http://localhost |
| 🔌 **Backend API** | http://localhost:8000 |
| 📑 **Swagger Docs** | http://localhost:8000/docs |

> **หมายเหตุ**: nginx proxy `/api/*` และ `/ws` ไปที่ backend อัตโนมัติ

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
| `VITE_API_URL` | `http://localhost:8000` | URL ของ Backend API |
| `VITE_WS_URL` | `ws://localhost:8000` | WebSocket URL สำหรับ Live Robot |

ใช้งานใน React:
```js
const apiUrl = import.meta.env.VITE_API_URL
```

### Backend (`backend/.env`)

| Variable | Default | คำอธิบาย |
|---|---|---|
| `HOST` | `0.0.0.0` | Host ที่ bind (uvicorn อ่านจาก compose command) |
| `PORT` | `8000` | Port ของ server |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS Origins (คั่นด้วยคอมม่า) |
| `DATABASE_URL` | `postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings` | PostgreSQL DSN |
| `ROBOT_IP` | `192.168.10.110` | IP ของตัวควบคุม Dobot |
| `ROBOT_PORT` | `29999` | Port ของ Dobot |
| `JWT_SECRET` | `robot-arm-secret-change-me` | JWT Secret Key (auth.py อ่านตัวนี้) |
| `BLYNK_TOKEN` | — | Token ของ Blynk (relay) |

> **ค่าของ robot / camera / align / draw** (เช่น `ROBOT_IP` default, `DEPTH_CAM_SERIAL`, `HOME_*`, `MOVE_SPEED`, `ALIGN_*`, `DRAW_*`) โหลดจาก `backend/.maps_point.env` โดย `maps_point/config.py` (`override=True`)

> ⚠️ **docker compose `env_file` ฝัง env ตั้งแต่ตอนสร้าง container** — แก้ `.env` แล้ว `docker restart` **ไม่พอ** ต้อง `docker compose up -d --force-recreate backend` ไม่งั้นค่าเก่ายังค้าง (เช่น `ROBOT_IP` เก่าทำให้ต่อหุ่นไม่ได้ + ค้างที่ SYN-SENT)

---

## 📡 API Endpoints

### 🔑 Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | เข้าสู่ระบบ `{ "username": "...", "password": "..." }` |
| `POST` | `/api/auth/logout` | ออกจากระบบ |

### 🤖 Robot Control (`/api/robot`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/robot/status` | ดึงพิกัดและมุมข้อต่อปัจจุบัน |
| `POST` | `/api/robot/move` | ขยับ `{ "axis": "X", "direction": "+", "step": 1.0 }` |
| `POST` | `/api/robot/emergency-stop` | หยุดฉุกเฉินทันที |
| `POST` | `/api/robot/draw` | ส่ง Trajectory วาดภาพ |

### 📹 Camera (`/api/camera`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/camera/stream` | MJPEG Video Stream |
| `GET` | `/api/camera/snapshot` | ดึงภาพนิ่ง (`image/jpeg`) |

---

## 🗺️ Frontend Routes

| Path | หน้าที่ |
|---|---|
| `/login` | หน้า Login (Glassmorphism UI) |
| `/dashboard` | ภาพรวมสถานะระบบ |
| `/dobot` | ควบคุม Jog + 3D Viewer + Live Coords |
| `/camera` | กล้องสด + Snapshot |
| `/drawing` | Drawing Mode / Trajectory |
| `/settings` | ตั้งค่าระบบ |

---

## 🧩 3D Robot Viewer (`/robot-viewer.html`)

Three.js viewer โหลดโมเดล `.dae` จริงและรองรับ:

| ฟีเจอร์ | วิธีใช้ |
|---|---|
| **IK Drag** | ลากลูกบอลสีส้ม 🟠 ที่ปลายแขนเพื่อขยับทุกข้อต่อ |
| **Translate / Rotate** | กด `Space` สลับโหมด |
| **หมุนกล้อง** | คลิกพื้นหลัง + ลาก |
| **Zoom** | Scroll |
| **Live Coords** | ส่งพิกัด X/Y/Z/RX/RY/RZ + J1–J6 ไปยัง Control Panel ผ่าน `postMessage` |
| **ควบคุมจาก React** | `iframe.contentWindow.postMessage({ type: 'setJoints', joints: [j1..j6] }, '*')` |

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

1. **Emergency Stop**: HTTP POST ทันทีเมื่อกดปุ่ม E-Stop
2. **CORS**: อ่านจาก `ALLOWED_ORIGINS` env — ไม่ hardcode
3. **Secrets**: `.env` อยู่ใน `.gitignore` — ห้าม commit
4. **Docker**: Multi-stage build — image final ไม่มี Node.js source

---

## 📄 License & Credits

พัฒนาขึ้นสำหรับการเชื่อมต่อและควบคุมหุ่นยนต์แขนกล Dobot ผ่าน Web Technologies (FastAPI + React + Three.js)
