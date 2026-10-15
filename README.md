# Web Robot — Control Center & Dashboard for Robotic Arm

Web Robot คือเว็บแอปพลิเคชันสำหรับควบคุมและติดตามสถานะของหุ่นยนต์แขนกล **Dobot CR5** ร่วมกับกล้อง **Intel RealSense D455** แบบเรียลไทม์ ผ่านหน้าเว็บ Interactive รองรับ Jog Control แบบ Cartesian และ Joint, ดูภาพกล้องสดได้สูงสุด 2 ตัว, โหมดสอนเส้นวาด (Drawing Mode), Auto-Align ระนาบด้วย depth และระบบหยุดฉุกเฉิน

ระบบรันบน **Raspberry Pi 5** ในรูปแบบ Docker stack (FastAPI + React + PostgreSQL) และเข้าถึงจากระยะไกลผ่าน **Cloudflare Tunnel** ได้

---

## สารบัญ

- [Quick Start](#quick-start)
- [ความสามารถหลัก](#ความสามารถหลัก)
- [วิธีใช้งาน](#วิธีใช้งาน)
- [สถาปัตยกรรม](#สถาปัตยกรรม)
- [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)
- [Backend](#backend)
- [Frontend](#frontend)
- [3D Robot Viewer](#3d-robot-viewer)
- [ฐานข้อมูล](#ฐานข้อมูล)
- [Environment Variables](#environment-variables)
- [การทดสอบ](#การทดสอบ)
- [Deploy](#deploy)
- [ข้อจำกัดที่รู้อยู่](#ข้อจำกัดที่รู้อยู่)
- [License](#license)
- [Credits](#credits)

---

## Quick Start

ต้องการ Docker (แนะนำ), หรือ Node.js 18+ และ Python 3.10+ เมื่อต้องการรันแบบ development

```bash
git clone <repo-url>
cd web_robot

cp backend/.env.example           backend/.env
cp backend/.maps_point.env.example backend/.maps_point.env
cp frontend/.env.example          frontend/.env

docker compose up -d --build
```

| Service | URL |
|---|---|
| Web application | `http://<host>` |
| Backend API | `http://<host>:8000` |
| Swagger | `http://<host>:8000/docs` |

ต้องตั้งค่าก่อนใช้งานจริงอย่างน้อย 2 ค่า: `JWT_SECRET` ใน `backend/.env` (backend จะไม่ start ถ้าเว้นหรือสั้นเกิน 16 ตัวอักษร) และ `ROBOT_IP` ใน `backend/.maps_point.env`

**รันแบบ development**

```bash
# Backend
cd backend
python -m venv venv
venv/Scripts/activate                 # Windows
source venv/bin/activate              # macOS / Linux
pip install -r requirements.txt -r requirements-dev.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend (อีก terminal)
cd frontend
npm install
npm run dev                           # http://localhost:5173
```

---

## ความสามารถหลัก

**Dobot Controller (`/dobot`)**
- Jog แบบ Cartesian (X, Y, Z, RX, RY, RZ) และ Joint (J1–J6) พร้อม step 0.1 / 1 / 5 / 10 / 20 / 50
- ปุ่ม Enable / Disable, Init, Clear Error และ Home
- เลือก Coordinate Frame: Tool (0–19) และ User (0–9)
- 3D viewer แบบ iframe พร้อม IK drag ที่ปลายแขน, snap จุดทาง (ghost waypoints) และรันตามลำดับจุด
- อ่านพิกัดสดผ่าน WebSocket รวมถึงค่า Tip ของปลาย tool และแก้พิกัดด้วยตนเองได้

**Camera (`/camera`)**
- สตรีม MJPEG ของกล้องหลักและกล้องรอง พร้อมโหมด `rgb` / `gray` / `depth`
- สลับมุมมองระหว่างสองกล้อง, โหมดเต็มจอ, ปุ่ม Home และ readout สถานะหุ่น
- เลือกกล้องหลัก/รอง, สแกนอุปกรณ์ และสลับกล้องได้จากหน้า Settings

**Drawing Mode (`/drawing`)**
- Fabric.js canvas พร้อมเครื่องมือ Select, Pen, Line, Rectangle, Triangle, Circle
- Undo / Redo, ลบสิ่งที่เลือก, ส่งออก PNG และส่งเส้นวาดเข้าหุ่น
- สอน grid N×M ด้วยการ jog มือ แล้ว map ด้วย bilinear interpolation จาก 4 จุดที่มาร์คไว้
- แผง Teach 4 แท็บ: Align, Jog, Grid, Draw พร้อมวัดความแม่นยำ 5 จุดและดาวน์โหลดรายงาน

**Auto-Align**
- วัดระนาบจาก depth ล้วนด้วย region growing ไม่ใช้ optical flow
- หมุน tool 3 เฟส: probe หาทิศทาง → converge tilt (RX, RY) → แก้ roll (RZ)
- มี guard สำหรับ diverge, recenter, re-probe และค่า RMSE สูงสุด
- บันทึกภาพและค่าทุก step ลง `backend/maps_point/recordings/` เพื่อตรวจสอบย้อนหลัง

**Scan & Fuse**
- เก็บหลายมุมมองของกล้องรองแล้ว fuse เป็น voxel map เดียว
- Auto-align ระหว่างกล้องด้วย ICP บน server และส่งผลกลับผ่าน WebSocket
- บันทึกและโหลด session เป็น `.npz` และ `.ply`

**ระบบอื่น**
- Dashboard: เปิด/ปิด relay ผ่าน Blynk พร้อม ping สถานะอุปกรณ์
- Activity Log (`/logs`): ค้นหาและกรอง event log ย้อนหลัง
- System Settings: Robot IP/ports, Home Position, เลือกกล้อง
- ปุ่ม E-Stop และ spacebar ที่ทำงานจากทุกหน้า

---

## วิธีใช้งาน

### เข้าสู่ระบบ

`POST /api/auth/login` ด้วย username และ password จะได้ JWT อายุ 72 ชั่วโมง เก็บไว้ที่ `localStorage.access_token` จากนั้นทุกคำขอจะแนบ header `Authorization: Bearer <token>`

การสมัครผู้ใช้ใหม่ผ่าน `POST /api/auth/register` ถูกปิดไว้โดยตั้งใจ — ต้องมี session ที่ล็อกอินอยู่ก่อนจึงจะเรียกได้ และหน้าเว็บไม่มีปุ่ม register

### เริ่มใช้งานหุ่น

ครั้งแรกที่เปิดหน้า Dobot Controller ระบบจะเรียก `connect` → `camstart` → `init` ให้อัตโนมัติ หากต้องการควบคุมเองให้กด Init และ Enable ที่แผบด้านขวา

ทุกคำสั่งเคลื่อนที่ถูก serialize ด้วย `robot_lock` (RLock) และปฏิเสธ jog ใหม่ได้ถ้ามี align, draw หรือ sequence กำลังรัน

### วิธี calibrate และ align

1. ตั้ง Home Position ในหน้า Settings (บันทึกต่อผู้ใช้ในฐานข้อมูล)
2. ในหน้า Drawing เปิด Mark แล้วคลิกมาร์กมุมของวัตถุในภาพ 4 จุด
3. กด Align ระบบจะหมุน tool รอบ `WELD_TOOL_INDEX` เพื่อทำให้ tool ตั้งฉากกับระนาบ
4. ตรวจค่า Plane Tilt และ Fit RMSE ในแท็บ Align

### วิธีส่งเส้นวาด

1. ตั้งขนาด grid แล้วกด Auto-fill หรือมาร์กทีละจุด (หมายเหตุ: row/column เริ่มที่ 1)
2. กดปุ่มตั้ง Z เพื่อกำหนดระดับพื้นผิวงาน
3. วาดเส้นบน canvas แล้วกด Send to Robot

ระบบจะปฏิเสธการส่งถ้า grid ยังไม่ครบ, ขนาด grid เล็กเกินไป หรือหุ่นยังไม่พร้อม

---

## สถาปัตยกรรม

```mermaid
graph TD
    User([Operator]) <-->|HTTPS| CF[Cloudflare Tunnel]
    CF --> NG["nginx :80"]
    NG -->|"/api/*"| API["FastAPI :8000"]
    NG -->|"/ws"| API
    NG -->|static| FE[React SPA]

    API -->|librealsense| CAM["RealSense D455"]
    API -->|TCP 29999 / 30003| DOB[Dobot CR5]
    API --> PG[(PostgreSQL)]

    FE -->|iframe| VIEW["robot-viewer.html"]

    FE <-->|"GET /api/*"| API
    FE <-->|"/ws/joints"| WSJ["joint broadcast<br/>20 Hz"]
    VIEW <-->|"/api/scan/ws"| WSS["live fused cloud<br/>binary"]
    VIEW <-->|"/api/scan/ws/align"| WSA["ICP result<br/>4 Hz"]
    WSJ & WSS & WSA --- API

    FE <-->|"postMessage"| VIEW
```

### ช่องทางการสื่อสารทั้ง 4 แบบ

| ช่องทาง | ใช้ทำอะไร | ลักษณะ |
|---|---|---|
| REST `/api/*` | คำสั่งและสถานะทั้งหมด | request/response, ต้องมี Bearer token |
| MJPEG `/api/map/video_feed`, `/api/camera/stream2` | ภาพกล้องสด | streaming, unbuffered, อ่านด้วยการแยกเฟรมเอง |
| WebSocket | ข้อมูลต่อเนื่อง | ยืนยันตัวตนด้วย `?token=` เพราะ handshake ส่ง header ไม่ได้ |
| `postMessage` | viewer ประสานงานกับ React | ในเครื่องผ่าน iframe ไม่ออกเครือข่าย |

### WebSocket ทั้ง 3 ช่อง

| Endpoint | ผู้ฟัง | ข้อมูล | ความถี่ |
|---|---|---|---|
| `/ws/joints` | React (`useJointsSocket`) | `{ angles, connected, pose }` ทุก tick ปัจจุบัน | 20 Hz (pose ทุก tick คู่) |
| `/api/scan/ws` | viewer (`viewer-scan-align.js`) | binary: `uint32 N` + `int16[N,3]` mm + `uint8[N,3]` rgb | 0.15 s เมื่อมีผู้ดู, 0.3 s idle |
| `/api/scan/ws/align` | viewer | `{ xyz, rpy, fitness, rmse }` จาก ICP | 0.25 s |

ทุก handler ตรวจ token เองก่อน accept และปิดด้วย code 1008 เมื่อไม่ผ่าน ฝั่ง client คือ `useJointsSocket` ที่ใช้ socket เดียวร่วมกันทั้งแอป (ref count) ส่วนอีกสองช่องเปิดเฉพาะเมื่อมี viewer เปิดค้างไว้

> ช่องทางอื่นที่ viewer ใช้เป็น HTTP polling ไม่ใช่ WebSocket ได้แก่ depth grid (100–200 ms), point cloud (700–800 ms) และภาพ MJPEG

### หลักการที่ยึด

**กล้องและหุ่นเป็น singleton ที่มีเธรดเดียว** — `Camera` มี capture thread เดียวที่เขียนลง shared buffers (`_color_buf`, `_depth_buf`, `_accel_buf`) ทุก endpoint อ่านผ่าน getter ที่ thread-safe (`get_latest_frames_ref()`) จึงเปิด viewer ได้หลายตัวโดยไม่แย่งกัน

**การ encode แชร์กัน** — `_encode_frame()` encode JPEG ครั้งเดียวต่อเฟรมแล้วเก็บใน cache ผู้ชม N คนจึงใช้ CPU เท่ากับคนเดียว พร้อมกั้นเวลา `X-Accel-Buffering: no` และ `proxy_buffering off` ที่ nginx เพื่อไม่ให้สตรีมถูกบัฟเฟอร์

**ทุกการเคลื่อนที่ถูก serialize** — `robot_lock` ครอบทุกคำสั่ง jog, move, align และ draw ป้องกันคำสั่งชนกัน

### Startup sequence

Backend ทำงานตอน import และตอน lifespan:

1. โหลด `.env` ด้วย `load_dotenv()` แล้ว import router
2. สร้าง `robot`, `cam`, `state` และเริ่ม tracking thread กับ autosave thread ทันที
3. สร้างตารางด้วย `Base.metadata.create_all`
4. เพิ่ม threadpool token เป็น 80 (ค่าเริ่มต้น 40 ไม่พอสำหรับ MJPEG ที่จอง worker ทั้ง session)
5. เธรด `_auto_start_camera` จะสลับไป enumerate กล้องก่อนเปิด pipeline เสมอ (ป้องกัน librealsense deadlock) แล้วค่อย retry เปิดกล้อง 3 ครั้ง ห่างกัน 5 วินาที
6. เธรดแยกต่อ `robot.connect()` — ไม่มี retry

> ไม่มีโค้ด shutdown: ไม่มีการปิด socket, ไม่ dispose engine และไม่ join thread

---

## โครงสร้างโปรเจกต์

```text
web_robot/
├── README.md
├── docker-compose.yml             # PostgreSQL + Backend + Frontend
├── evidence/                      # CSV ผลทดสอบ + ภาพหลักฐาน
├── archive/                       # ไฟล์รุ่นเก่าที่ถูกแทนที่แล้ว
│
├── backend/
│   ├── main.py                    # app, lifespan, middleware, /ws/joints
│   ├── database.py                # async engine + get_db()
│   ├── models.py                  # users / user_settings / device_logs
│   ├── state_store.py             # snapshot marks + grid -> state_snapshot.json
│   ├── requirements.txt           # runtime
│   ├── requirements-dev.txt       # test only (ไม่รวม pyrealsense2)
│   ├── pytest.ini
│   ├── Dockerfile                 # python:3.12-slim + libusb/libgl
│   ├── run.bat
│   ├── .env.example
│   ├── .maps_point.env.example
│   ├── routers/
│   │   ├── auth.py                # /api/auth
│   │   ├── camera.py              # /api/camera  (ถือ singleton กล้องรอง)
│   │   ├── mapcontrol.py          # /api/map     (2088 บรรทัด)
│   │   ├── scan.py                # /api/scan    (capture/fuse/ICP + WS)
│   │   ├── settings.py            # /api/settings
│   │   ├── devices.py             # /api/devices (relay + event log)
│   │   ├── device_events.py       # best-effort event writer
│   │   └── robot.py               # /api/robot   (E-Stop)
│   ├── maps_point/                # ชั้นควบคุมฮาร์ดแวร์ ไม่ผูก HTTP
│   │   ├── config.py              # รวมค่าจาก .maps_point.env (override=True)
│   │   ├── camera.py              # D455 pipeline, capture thread, region grow
│   │   ├── robot.py               # Dobot wrapper 2 ports
│   │   ├── dobot_api_v3.py        # Dobot TCP/IP-Remote SDK (vendored)
│   │   ├── align.py               # align 3 เฟส + AppState + tracking loop
│   │   ├── planegrid.py           # grid plane + เส้นวาด + test report
│   │   ├── motion.py              # pixel -> robot XY
│   │   ├── floorcalib.py          # homography (eye-to-hand)
│   │   ├── render.py              # overlay ลงเฟรม
│   │   ├── recording.py           # บันทึก align run
│   │   └── logs.py                # ring log 2 ตัว
│   └── tests/
│       ├── conftest.py
│       ├── test_planegrid.py      # 122 เคส
│       ├── test_auth.py           # 11 เคส
│       ├── test_config.py         # 5 เคส
│       ├── test_models.py         # 5 เคส
│       ├── test_floorcalib.py     # 8 เคส
│       └── test_pose_source.py    # 7 เคส
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── vitest.config.js
│   ├── .oxlintrc.json
│   ├── nginx.conf
│   ├── Dockerfile                 # node:22-alpine -> nginx:alpine
│   ├── src/
│   │   ├── App.jsx                # routing ทั้งหมด
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── lib/
│   │   │   ├── api.js             # apiFetch, token helpers
│   │   │   ├── useJointsSocket.js # shared /ws/joints hook
│   │   │   ├── shapes.js          # fillet + shape geometry
│   │   │   ├── robotLogFormat.js  # แปลง TCP log เป็นภาษาคน
│   │   │   └── api.test.js, shapes.test.js, robotLogFormat.test.js
│   │   ├── components/
│   │   │   ├── CameraStream.jsx   # MJPEG -> canvas
│   │   │   ├── RobotLogPanel.jsx
│   │   │   ├── RequireAuth.jsx
│   │   │   ├── ApiErrorBanner.jsx
│   │   │   ├── Sidebar.jsx        # rail + bottom nav + speed
│   │   │   ├── TopBar.jsx         # title + connect + E-Stop
│   │   │   └── *.test.jsx
│   │   └── pages/
│   │       ├── LoginPage.jsx
│   │       ├── DashboardPage.jsx
│   │       ├── DobotControllerPage.jsx
│   │       ├── CameraViewPage.jsx
│   │       ├── DrawingModePage.jsx
│   │       ├── LogsPage.jsx
│   │       ├── SystemSettingsPage.jsx
│   │       ├── reportGate.js      # gate การดาวน์โหลดรายงาน
│   │       └── *.test.*
│   └── public/
│       ├── robot-viewer.html      # หน้า viewer + script tags
│       ├── viewer-boot.js         # scene, กล้อง, โหลดโมเดล .dae
│       ├── viewer-projector.js    # marker, point cloud, depth mesh
│       ├── viewer-scan-align.js   # scan/fuse, cam2 extrinsic, ICP
│       ├── viewer-gizmo.js        # ลูกศรโค้ง J4/J5 + TransformControls
│       ├── viewer-ik.js           # CCD IK + model->robot frame
│       ├── viewer-host-bridge.js  # postMessage ไป React
│       ├── viewer-loop.js         # render loop + tcpUpdate
│       └── models/                # base_link, Link1..Link6, Link6_S (.dae)
│
└── tools/
    └── gen_test_cases.py          # สคริปต์สร้างชุดทดสอบ
```

---

## Backend

### Middleware

| ชั้น | พฤติกรรม |
|---|---|
| CORS | `allow_origins` จาก `ALLOWED_ORIGINS` (คั่นด้วยคอมม่า) เป็นชั้นนอกสุด เพื่อให้ response 401 ยังมี header CORS |
| Bearer token | บังคับทุก path ที่ขึ้นต้น `/api/` ยกเว้น `/api/auth/` และข้ามเมื่อ `method == OPTIONS` หรือเป็น WebSocket upgrade |

ทุก route ยังมี `Depends(get_current_user)` ซ้ำอีกชั้นหนึ่ง และบาง route เรียกซ้ำสองครั้ง (`/api/map/home`, `/api/map/pose-source`, `/api/map/test-report`, routes ของ `/api/devices`) — ไม่ผิดการทำงานแต่เปลืองการ decode token

### WebSocket

| Endpoint | ข้อมูลที่ส่งกลับ |
|---|---|
| `/ws/joints?token=` | JSON ทุก 50 ms: `{ angles: [6], connected, pose: [6] }` — pose ส่งทุก tick ที่เป็นคู่ |
| `/api/scan/ws?token=` | binary: `uint32 N` + `int16[N,3]` (mm) + `uint8[N,3]` (rgb) — โหมด live ทุก 0.15 s, idle 0.3 s, ย่อยเหลือ 6000 จุด |
| `/api/scan/ws/align?token=` | JSON ทุก 0.25 s: `{ xyz, rpy, fitness, rmse }` จาก ICP; ค่าล่าสุดถูกส่งซ้ำทันทีตอนเชื่อมต่อ |

การยืนยันตัวตนทำที่ query `?token=` เท่านั้น และปิดด้วย code 1008 เมื่อ token ไม่ผ่าน

### API หลัก

**`/api/auth`** — `POST /login`, `POST /register` (ต้องล็อกอินก่อน), `GET /me`

**`/api/map`** — กลุ่มที่ใหญ่ที่สุด
- หุ่น: `POST /connect` `/init` `/enable` `/disable` `/camstart` `/error` `/emergency` `/home`
- การเคลื่อนที่: `POST /jog` `/jog_joint` `/move_to` `/move_sequence` `/move_sequence/stop` `/frame`
- ภาพ: `GET /video_feed` (MJPEG) `/depth_grid` `/depth_frame` `/color_frame` `/pointcloud` `/camera_intrinsics`
- การมาร์ก: `POST /point` `/reset_points` `/goto` `/align` `/align/stop`
- Grid: `POST /grid/size` `/grid/mark` `/grid/autofill` `/grid/setz` `/grid/surfacez` `/grid/reset` `/grid/restore`
- ทดสอบความแม่นยำ: `POST /grid/test-point` `/grid/verify` `/grid/test-reset`, `GET /test-report`, `GET /pose-source`
- Floor calibration: `GET /floorcalib`, `POST /floorcalib/point` `/floorcalib/reset` `/floorcalib/floorz` `/floorcalib/goto`
- วัดพื้นที่และ align: `POST /object_area` `/area_plane` `/plane_background` `/align_icp`
- อื่น: `GET /status` `/joints` `/logs` `/robot_logs` `/camera_mode`, `POST /draw` `/draw/stop` `/heatmap/toggle` `/cli`

**`/api/camera`** — `GET /stream` `/stream2` `/snapshot` `/snapshot2` `/devices` `/mode` `/mode2` `/pointcloud2` `/depth_grid2`, `POST /scan` `/select` `/swap` `/mode/toggle`

**`/api/scan`** — `POST /capture` `/fuse` `/save` `/views/clear` `/extrinsics` `/load/{session}`, `GET /views` `/cloud` `/sessions` `/extrinsics`, `DELETE /views/{id}`

**`/api/devices`** — `POST /relay/toggle` `/events/prune`, `GET /relay/state` `/relay/history` `/events` `/ping`

**`/api/settings`** — `GET /api/settings`, `PUT /api/settings`, `PUT /api/settings/{key}`

**`/api/robot`** — `POST /api/robot/emergency-stop`

### สถิติสตรีม

| | กล้องหลัก | กล้องรอง |
|---|---|---|
| ความละเอียด | 848 x 480 | 848 x 480 |
| JPEG quality | 65 | 70 |
| เฟรมสูงสุด | 15 fps | 8 fps |
| endpoint | `/api/map/video_feed` | `/api/camera/stream2` |

Depth grid ส่งเป็น binary `uint16` ขนาด 212 x 120

### โมดูล `maps_point/`

| โมดูล | หน้าที่ |
|---|---|
| `config.py` | รวมค่าคงที่ทั้งหมดจาก `.maps_point.env` ด้วย `override=True` อ่านค่าครั้งเดียวตอน import |
| `camera.py` | เปิด D455, capture thread เดียว, rolling depth buffer (`DEPTH_N_FRAMES`), USB power-cycle เมื่อ frame ค้าง, สร้าง SDK point cloud ทุก 12 เฟรม, `sample_plane_region_grow()` สำหรับ align |
| `robot.py` | wrapper Dobot SDK 2 socket, `_wait_stable()` ดู 6 DOF, `RobotMoveError`, `pose_source_report()` ตรวจว่า GetPose คืนค่าจริงหรือ echo คำสั่ง |
| `dobot_api_v3.py` | SDK TCP/IP-Remote ของ Dobot ที่ vendor มาไว้ในรีโป |
| `align.py` | `AppState`, align 3 เฟส, tracking loop ต่อเนื่องที่อัปเดต `last_tilt` / `last_rmse` ทุก 30 ms |
| `planegrid.py` | `bilinear_cell`, `grid_pose`, `validate_grid`, `simplify_stroke`, `draw_stats`, `build_test_report_payload`, `do_verify_grid`, `do_draw` |
| `motion.py` | แปลง pixel เป็น robot XY (eye-in-hand) — แกนภาพแนวตั้งแมดกับแกน X ของหุ่น |
| `floorcalib.py` | DLT homography จากจุดสอน 4 จุดขึ้นไป เก็บที่ `backend/floor_calib.json` |
| `render.py` | วาดจุดมาร์ก รูปสี่เหลี่ยม และแถบสถานะลงเฟรม |
| `recording.py` | บันทึก JPEG + `steps.jsonl` ทุก step ของ align |
| `logs.py` | ring buffer 500 รายการ 2 ตัว (`server_ring`, `robot_ring`) พร้อมบังคับ stdout เป็น UTF-8 |

---

## Frontend

### Routes

| Path | หน้า | ต้องล็อกอิน |
|---|---|---|
| `/login` | LoginPage | ไม่ |
| `/dashboard` | DashboardPage | ใช่ |
| `/camera` | CameraViewPage | ใช่ |
| `/drawing` | DrawingModePage | ใช่ |
| `/dobot` | DobotControllerPage | ใช่ |
| `/settings` | SystemSettingsPage | ใช่ |
| `/logs` | LogsPage | ใช่ |

`/` redirect ไป `/login` — **ไม่มี catch-all route** เส้นทางที่ไม่รู้จักจะแสดงหน้าว่าง

### การจัดการ API (`src/lib/api.js`)

- ทุก URL เป็น root-relative (`/api/...`) ไม่มีการต่อ base URL — ให้ nginx ตัดสินใจเรื่อง host
- แนบ `Authorization` เฉพาะเมื่อ caller ไม่ได้ใส่มาเอง
- **retry เฉพาะ GET**: ถ้าได้ 5xx จะรอ 1200 ms แล้วยิงซ้ำ 1 ครั้ง (POST ไม่ retry)
- 401 ที่ไม่ใช่ `/api/auth/` จะลบ token และ redirect ไป `/login`
- 5xx ที่ยังค้างหลัง retry จะยิง event `api:server-error` ให้ `ApiErrorBanner` แสดงแถบแจ้งเตือน (ซ่อนเองใน 8 วินาที)

### การอ่าน MJPEG (`CameraStream.jsx`)

ไม่ได้ใช้ `<img src>` แต่อ่าน `response.body` ด้วย `ReadableStream` แล้วแยกเฟรมเองด้วย marker JPEG (`FF D8` ถึง `FF D9`) จากนั้นวาดลง `<canvas>` ด้วย `createImageBitmap`

- ถ้าไม่มี token จะลองใหม่ทุก 2 วินาที, หลุดจะ reconnect ใน 500 ms
- watchdog ยกเลิกการอ่านถ้าไม่มีเฟรมเกิน 3 วินาที
- **มี canvas ตัวเดียวทั้งแอป** ซ่อนอยู่ใน dock แล้วถูก `appendChild` เข้าหน้าที่กำลังแสดง การสลับหน้าจึงย้าย element เดียวกัน ไม่เปิดสตรีมใหม่
- `ResizeObserver` เริ่มและหยุดสตรีมตามขนาด canvas ทำให้เปิดสตรีมเฉพาะตอนมีหน้าที่มองเห็นจริง

### WebSocket ฝั่ง client

`useJointsSocket` ใช้ socket เดียวร่วมกันทั้งแอป (ref count) ต่อ URL จาก `location.host` พร้อมแนบ token และ reconnect ทุก 1–2 วินาที `TopBar` ใช้ `connected` จาก socket นี้เป็นสถานะการเชื่อมต่อ ไม่ได้ poll `/api/map/status`

### nginx

| location | การจัดการ |
|---|---|
| `/assets/` | `Cache-Control: public, immutable` |
| `/models/` | `Cache-Control: public` |
| `= /index.html` | `no-store` เพื่อไม่ให้ผู้ใช้ค้างที่ bundle เก่า |
| `= /robot-viewer.html` | `no-store` |
| `/` | SPA fallback เสิร์ฟ `index.html` |
| `^/api/(map/video_feed\|camera/stream)$` | `proxy_buffering off` + `X-Accel-Buffering: no` |
| `/api/` | proxy ไป `127.0.0.1:8000` |
| `/api/scan/ws` | ต้องมาก่อน `/api/` เพราะต้องส่ง header Upgrade |
| `/ws` | proxy ไป backend |

---

## 3D Robot Viewer

หน้า `public/robot-viewer.html` เป็น standalone page ที่ถูกโหลดใน `<iframe>` โดยใช้ Three.js **r128** จาก CDN (cdnjs + jsdelivr) แบบ classic script ไม่ใช้ module

**ลำดับการโหลดสคริปต์สำคัญมาก** — แต่ละไฟล์ขึ้นกับตัวแปรของไฟล์ก่อนหน้า:

```
viewer-boot.js → viewer-projector.js → viewer-scan-align.js
→ viewer-gizmo.js → viewer-ik.js → viewer-host-bridge.js → viewer-loop.js
```

**โมเดล** — โหลด 7 ไฟล์ `.dae`: `base_link`, `Link1`–`Link5` และ `Link6_S` โดย `Link6_S` ถูกย้อมเป็นสีแดงด้วย `MeshBasicMaterial` และซ่อนไฟกับกล้อง 14 ตัวที่ฝังมาในไฟล์ เพราะทำให้สีของโมเดลซีดจาง

**การควบคุม**
- ลากลูกบอลที่ปลายแขนเพื่อ IK (CCD)
- ลูกศรโค้งสีแดง = J4, สีเขียว = J5 ลากเพื่อหมุนข้อต่อเดี่ยว
- `Space` สลับระหว่าง Translate และ Rotate
- ลากพื้นหลังเพื่อหมุนกล้อง, scroll เพื่อ zoom

**การสื่อสารกับ React ผ่าน `postMessage`**

| ทิศทาง | ข้อความ |
|---|---|
| viewer → React | `gizmoDragStart`, `targetPoseUpdate`, `tcpUpdate`, `ghostListUpdate`, `ghostPoseUpdate`, `ghostCleared` |
| React → viewer | `setJoints`, `getPosState`, `snapGhost`, `snapPos`, `clearGhost`, `clearAllGhosts`, `deleteGhostTarget`, `highlightGhost` |

**โหมดแสดงผลอย่างเดียว** — เติม query `?mode=display` เพื่อซ่อนแถบเครื่องมือและปิด point cloud / depth mesh ทั้งหมด ประหยัด bandwidth ที่ไม่ได้ใช้

**ฟีเจอร์ด้าน vision ใน viewer** — point cloud และ depth mesh ของทั้งสองกล้อง, ตำแหน่งกล้องที่ปรับเทียบได้ผ่าน slider, บันทึก extrinsic ของกล้องรอง, และปุ่ม ICP auto-align

---

## ฐานข้อมูล

PostgreSQL 16 มี 3 ตาราง สร้างอัตโนมัติจาก SQLAlchemy `Base.metadata.create_all` ตอน startup ทุก primary key เป็น UUID4 แบบ string ไม่ใช่ serial

### `users`

| คอลัมน์ | ชนิด | Constraint |
|---|---|---|
| `id` | `String(36)` | PK |
| `username` | `String(64)` | UNIQUE, NOT NULL, INDEX |
| `password_hash` | `String(128)` | NOT NULL (bcrypt) |
| `created_at` | `DateTime(tz)` | UTC |

### `user_settings`

| คอลัมน์ | ชนิด | Constraint |
|---|---|---|
| `id` | `String(36)` | PK |
| `user_id` | `String(36)` | FK → `users.id` ON DELETE CASCADE, INDEX |
| `key` | `String(128)` | NOT NULL |
| `value` | `Text` | NOT NULL, default `''` |
| `updated_at` | `DateTime(tz)` | UTC, onupdate |

`UNIQUE(user_id, key)` ชื่อ `uq_user_setting` — ผู้ใช้ 1 คนมีค่าต่อ key ได้ค่าเดียว

คีย์ที่ใช้จริง: `home_x`–`home_rz`, `cam_serial`, `cam_serial2`, `cam_devices`, `sidebar_speed`, `robot_ip`, `move_speed`, `depth_roi`, `min_depth_mm`, `theme` (ค่า default อยู่ใน `backend/routers/settings.py`)

### `device_logs`

| คอลัมน์ | ชนิด | Constraint |
|---|---|---|
| `id` | `String(36)` | PK |
| `user_id` | `String(36)` | FK → `users.id` ON DELETE CASCADE, INDEX |
| `device` | `String(64)` | NOT NULL |
| `state` | `String(16)` | NOT NULL |
| `detail` | `Text` | NOT NULL, default `''` |
| `created_at` | `DateTime(tz)` | UTC |

อุปกรณ์ที่บันทึก: `robot`, `align`, `align_icp`, `camera`, `estop`, `relay_v1`, `draw` — ตารางโตเร็วเพราะ align เขียนเป็นลูป จึงมี `POST /api/devices/events/prune` ตัดให้เหลือ N แถวล่าสุดต่ออุปกรณ์

### Engine

`create_async_engine` พร้อม `pool_pre_ping=True`, `pool_recycle=1800`, `pool_size=10`, `max_overflow=20`, `pool_timeout=10` และแปลง `postgresql://` ให้เป็น `postgresql+asyncpg://` อัตโนมัติ

### ไฟล์ state นอกฐานข้อมูล

| ไฟล์ | เก็บอะไร |
|---|---|
| `backend/state_snapshot.json` | จุดมาร์กและ grid ที่สอนไว้ (autosave ทุก 2 วินาทีเมื่อค่าเปลี่ยน) |
| `backend/floor_calib.json` | จุดสอนและ homography ของกล้องกลาง |
| `backend/camera_selection.json` | serial กล้องหลัก/รองที่เลือกไว้ |
| `backend/camera_extrinsics.json` | extrinsic ที่ calibrate แล้วของกล้องทั้งสอง |
| `backend/maps_point/recordings/` | ภาพและ log ของแต่ละรอบ align |
| `backend/scan_sessions/` | session ที่บันทึกจาก Scan & Fuse |

---

## Environment Variables

### `backend/.env`

| Variable | Default | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings` | แปลง scheme ให้อัตโนมัติ |
| `JWT_SECRET` | — | **บังคับ** — backend raise ทันทีถ้าเว้น, เป็น placeholder ที่รู้จัก หรือยาวน้อยกว่า 16 ตัวอักษร |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | คั่นด้วยคอมม่า |
| `BLYNK_TOKEN` | — | ว่าง = ปิดฟังก์ชัน relay ทันทีโดยไม่ยิงเครือข่าย |

> `HOST`, `PORT` และ `ROBOT_PORT` มีอยู่ใน `.env.example` แต่ **ไม่มีโค้ดไหนอ่าน** พอร์ตของหุ่นมาจาก `maps_point/config.py` และ body ของ `POST /api/map/connect` แทน

### `backend/.maps_point.env`

โหลดด้วย `override=True` แปลว่า **ไฟล์นี้ชนะทั้ง `.env` และ environment ของ process** อ่านค่าครั้งเดียวตอน import — แก้แล้วต้อง restart

| กลุ่ม | ตัวแปรหลัก |
|---|---|
| หุ่น | `ROBOT_IP`, `Z_CALIB_SPEED` |
| กล้อง | `DEPTH_CAM_SERIAL`, `DEPTH_ROI`, `DEPTH_N_FRAMES`, `MIN_DEPTH_MM`, `CAM_X_SIGN`, `CAM_Y_SIGN`, `CAM_INTER_SYNC`, `CAM2_INTER_SYNC`, `CAM_TCP_OFFSET_X/Y`, `WELD_TOOL_INDEX` |
| align เฟส 1–2 | `ALIGN_GAIN_DEG`, `ALIGN_MAX_STEP_DEG`, `ALIGN_TOL_DEG`, `ALIGN_MAX_STEPS`, `ALIGN_PROBE_DEG`, `ALIGN_FINE_TILT_DEG`, `ALIGN_FINE_SCALE`, `ALIGN_APPROACH_Z_OFFSET`, `ALIGN_DIVERGE_MARGIN_DEG`, `ALIGN_MAX_REPROBES`, `ALIGN_RECENTER_MARGIN`, `ALIGN_MAX_RMSE_MM`, `ALIGN_DEPTH_TOL_MM` |
| align เฟส 3 (roll) | `ALIGN_RZ_TOL_DEG`, `ALIGN_RZ_GAIN`, `ALIGN_RZ_MAX_STEP_DEG`, `ALIGN_RZ_MAX_ITERS` |
| draw | `DRAW_SIMPLIFY_ENABLED`, `DRAW_SIMPLIFY_EPS`, `DRAW_MAX_POINTS`, `DRAW_GRID_MAX_ROWS`, `DRAW_GRID_MAX_COLS`, `DRAW_CP_RATIO`, `DRAW_MOTION_MODE`, `DRAW_SERVOP_*`, `DRAW_LIFT_MM`, `DRAW_MIN_GRID_SPAN_MM` |
| home และพื้นผิว | `HOME_X/Y/Z`, `HOME_RX/RY/RZ`, `Z_SURFACE`, `CAM_TIP_OFFSET_MM`, `DRAW_SURFACE_GAP_MM` |

> ตัวแปรหลายตัวถูกอ่านในโค้ดแต่ไม่มีในไฟล์ `.example` เช่น `CAM_INTER_SYNC`, `ALIGN_RZ_*`, `DRAW_SIMPLIFY_ENABLED` ส่วน `FLASK_HOST` / `FLASK_PORT` ใน `config.py` ไม่ถูกใช้เลย (โปรเจคนี้ไม่มี Flask)

### `frontend/.env`

| Variable | Default |
|---|---|
| `VITE_API_URL` | `http://localhost:8000` |
| `VITE_WS_URL` | `ws://localhost:8000` |

ใช้ตอน build เท่านั้น และใน dev เท่านั้น — โค้ด production เรียก `/api` และ `/ws` แบบ same-origin ผ่าน nginx และสร้าง URL จาก `location.host` เอง

---

## การทดสอบ

```bash
# Backend — 158 เคส
cd backend && python -m pytest

# Frontend — 100 เคส
cd frontend && npm run test
```

| ฝั่ง | ไฟล์ | เนื้อหา |
|---|---|---|
| Backend | `test_planegrid.py` | bilinear, grid pose, validate, simplify, report payload |
| Backend | `test_auth.py` | JWT, bcrypt, login, register |
| Backend | `test_floorcalib.py` | homography, reprojection RMSE, invert |
| Backend | `test_pose_source.py` | ตรวจว่า GetPose คืนค่าจริงหรือคำสั่ง echo |
| Backend | `test_config.py` | การ parse ค่าจาก env |
| Backend | `test_models.py` | UUID, unique constraint |
| Frontend | `shapes.test.js` | fillet และ shape geometry |
| Frontend | `reportGate.test.js` | gate การดาวน์โหลดรายงาน |
| Frontend | `api.test.js` | token, retry, 401 |
| Frontend | `robotLogFormat.test.js` | แปลง TCP log |
| Frontend | `ApiErrorBanner.test.jsx`, `RequireAuth.test.jsx`, `DrawingModePage.smoke.test.jsx` | component |

```bash
cd frontend
npm run lint        # oxlint
npm run build       # vite build
```

ผลทดสอบ manual 150 เคสอยู่ใน `evidence/test_cases_verified.csv` และ `evidence/manual_results_observed.csv` พร้อมภาพหลักฐาน

> `requirements-dev.txt` ไม่รวม `pyrealsense2` โดยเจตนา เพราะเป็น hardware-only dependency

---

## Deploy

### Docker Compose

| Service | รายละเอียด |
|---|---|
| `postgres` | `postgres:16-alpine`, port `127.0.0.1:5432` เท่านั้น, healthcheck ด้วย `pg_isready` |
| `backend` | `python:3.12-slim`, `network_mode: host`, bind mount `./backend:/app`, port 8000 |
| `frontend` | multi-stage `node:22-alpine` → `nginx:alpine`, `network_mode: host`, port 80 |

Backend ใช้ `network_mode: host` เพราะต้องเข้าถึง USB ของ RealSense และ TCP ของหุ่นโดยตรง

### Raspberry Pi

- Backend เป็น bind mount จึง restart เพื่อรันโค้ดใหม่ได้ทันที
- Frontend เป็น image ที่ bake มาแล้ว ต้อง `docker compose build frontend && docker compose up -d frontend` ทุกครั้งที่แก้โค้ด
- เข้าถึงจากภายนอกผ่าน `cloudflared` ที่รันแยกนอก compose
- **สำคัญ**: `env_file` ของ Compose ฝังค่าตอนสร้าง container — แก้ `.env` แล้ว `docker restart` ไม่พอ ต้อง `docker compose up -d --force-recreate backend`

---

## ข้อจำกัดที่รู้อยู่

| หัวข้อ | รายละเอียด |
|---|---|
| Tool frame ยังไม่ได้ calibrate | ค่า tool offset บนหุ่นจริงเป็นศูนย์ ทำให้ align หมุนรอบ flange แทนปลาย tool ต้องตั้งค่าใน DobotStudio ก่อน |
| โมเดลคลาดจากหุ่นจริง | ความยาว link ในไฟล์ `.dae` ไม่ตรงกับ CR5 จริง ทำให้ปลาย tool คลาดได้หลายมิลลิเมตรในบางท่า |
| `backend/maps_point/ailgn_back.py` | ไฟล์สำเนาเก่าของ `align.py` ที่ไม่มีโค้ดไหน import และ import แบบ absolute ซึ่งจะพังอยู่ดี ๆ — ควรลบ |
| `backend/maps_point/recordings/` | ไม่ได้อยู่ใน `.gitignore` ทำให้ไฟล์บันทึกของ align อาจถูก commit |
| `POST /api/scan/load/{session}` | ต่อชื่อ session เข้า path โดยตรง ไม่มีการกรอง path traversal |
| `POST /api/map/cli` | ตัวรับคำสั่งแบบ string dispatcher ที่ frontend ไม่ได้เรียกใช้ |
| `backend/routers/devices.py` | hardcode `ROBOT_IP = "192.168.10.110"` ไม่ได้อ่านจาก config |
| Lint warnings | มีตัวแปรที่ประกาศแล้วไม่ได้ใช้ประมาณ 30 จุด ใน `viewer-scan-align.js` และ `DrawingModePage.jsx` — ไม่มี error |
| โค้ดซ้ำซ้อน | `get_current_user` ถูกเรียกสองครั้งในบาง route และมี `authHeaders()` ซ้ำใน `Sidebar.jsx` กับ `DashboardPage.jsx` |
| ไม่มี CI | ยังไม่มี `.github/workflows` เทสต์ต้องรันเอง |

---

## License

โปรเจคนี้ใช้ **Apache License 2.0** — ดู [LICENSE](LICENSE) เต็มฉบับ

การใช้งานซอร์สโค้ดและไฟล์โมเดล `.dae` ภายในโปรเจคนี้ต้องคงหัวข้อสัญญาอนุญาตไว้ ส่วนซอร์สโค้ดที่ vendor มา (`backend/maps_point/dobot_api_v3.py`) ยังคงลิขสิทธิ์ของ Dobot ไว้ตามเดิม

## Credits

### ฮาร์ดแวร์

| อุปกรณ์ | ผู้ผลิต |
|---|---|
| Dobot CR5 | Dobot Robotics |
| Intel RealSense D455 (สูงสุด 2 ตัว) | Intel |
| Raspberry Pi 5 | Raspberry Pi Foundation |

### Backend

| ไลบรารี | ใช้ทำอะไร |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) | web framework และ ASGI server |
| [SQLAlchemy](https://www.sqlalchemy.org/) + [asyncpg](https://github.com/MagicStack/asyncpg) | ORM และ PostgreSQL driver |
| [python-jose](https://python-jose.readthedocs.io/) + [passlib](https://passlib.readthedocs.io/) | JWT และ bcrypt |
| [python-dotenv](https://pypi.org/project/python-dotenv/) | โหลดค่าจากไฟล์ env |
| [OpenCV](https://opencv.org/) (`opencv-python-headless`) | region growing, colormap, encode JPEG, overlay |
| [NumPy](https://numpy.org/) | คำนวณภาพ |
| [pyrealsense2](https://github.com/IntelRealSense/librealsense) | SDK ของ RealSense |
| [pytest](https://pytest.org/) | unit tests |

### Frontend

| ไลบรารี | ใช้ทำอะไร |
|---|---|
| [React](https://react.dev/) + [React Router](https://reactrouter.com/) | UI และ routing |
| [Vite](https://vitejs.dev/) | build tool |
| [Three.js](https://threejs.org/) r128 | 3D viewer (โหลดจาก CDN) |
| [Fabric.js](https://fabricjs.com/) | canvas วาดเส้น |
| [Oxlint](https://oxc.rs/) | linting |
| [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/) | unit tests |

### Infrastructure

| เครื่องมือ | ใช้ทำอะไร |
|---|---|
| [PostgreSQL](https://www.postgresql.org/) 16 | ฐานข้อมูล |
| [Docker](https://www.docker.com/) + Compose | container orchestration |
| [nginx](https://nginx.org/) | static serving และ reverse proxy |
| [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | Cloudflare Tunnel |
| [Adminer](https://www.adminer.org/) | เว็บดูฐานข้อมูล (ตัวเลือก) |

### ผู้พัฒนา

| ชื่อ | บัญชี GitHub |
|---|---|
| nareboo04 | [`nareboo04`](https://github.com/nareboo04) |
| Nawin0 | [`Nawin0`](https://github.com/Nawin0) |
| Numchai Wongjanjaroen | [`NCWJJ-BOX`](https://github.com/NCWJJ-BOX) |
> repository นี้อยู่ภายใต้องค์กร `RobotGuiding101`

### อ้างอิง

อัลกอริทึมการจับระนาบและการควบคุมการเคลื่อนที่อ้างอิงแนวทางจากโปรเจกต์ `version_3.0` ใน repository [RobotGuiding101/control_robot](https://github.com/RobotGuiding101/control_robot) (ผู้พัฒนา: `nareboo04`)