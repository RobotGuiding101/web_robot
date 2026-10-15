# 📦 HANDOFF — จุดส่งมอบงาน (Web Robot)

> เอกสารนี้คือ**ประตูสำหรับคน/ทีมถัดไป** — บอกว่าโปรเจคอยู่ตรงไหน รันยังไง และอะไรที่ยังค้าง
> อัปเดตล่าสุด: **2026-10-15** · branch `main` · commit `3e84f59`

---

## 1. 🎯 สถานะปัจจุบัน (Status)

| หัวข้อ | สถานะ |
|---|---|
| สาขาหลัก | `main` (รวม PR #3 จาก `dev-back-test` แล้ว) |
| Automated test | ✅ **Backend 158 เคสผ่าน** · **Frontend 100 เคสผ่าน** (7 ไฟล์) |
| Lint | ✅ `npm run lint` ไม่มี error (มี warning เรื่องตัวแปรที่ยังไม่ได้ใช้) |
| Build | ✅ `npm run build` สำเร็จ |
| การ deploy ล่าสุด | Docker stack บน Raspberry Pi 5 (`robot_backend`, `robot_frontend`, `postgres`, `adminer`) |
| Align เทียบ reference | ✅ ตรงกับ `version_3.0` (region-grow measurement เหมือนกัน) |
| ผลทดสอบหน้างาน | 150 เคส → **ผ่าน 91** · ต้องมี rig 30 · ต้องเปิดเบราว์เซอร์ 7 · ต้องตั้งค่าเพิ่ม 3 · ยังไม่บันทึกผล 19 |

รายละเอียดผลทดสอบทั้งหมด → **[evidence/test_cases_verified.csv](evidence/test_cases_verified.csv)** · สรุปเป็น Excel → **[TEST_CASES_new.xlsx](TEST_CASES_new.xlsx)**

---

## 2. 🚀 วิธีรัน (Quick Start)

### แบบ Docker (แนะนำ — เหมือน production)
```bash
git clone <repo>
cd web_robot
cp backend/.env.example          backend/.env
cp backend/.maps_point.env.example backend/.maps_point.env
cp frontend/.env.example         frontend/.env
# แก้ค่าให้ตรงเครื่อง (ดูหัวข้อ 3)
docker compose build
docker compose up -d
docker compose logs -f backend
```
| service | URL |
|---|---|
| Web app (nginx) | `http://<IP>` |
| Backend / Swagger | `http://<IP>:8000` · `/docs` |
| PostgreSQL | `127.0.0.1:5432` (ผูกเฉพาะ localhost เท่านั้น) |
| Adminer (ถ้าต้องการ) | รันแยก `docker run --link robot_postgres:db -p 8080:8080 adminer` |

> `backend` และ `frontend` ใช้ `network_mode: host` จึงเข้าผ่าน IP ของเครื่องตรง ๆ

### แบบ Dev
```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev      # http://localhost:5173
```

### ทดสอบ
```bash
# Backend — 158 เคส (ไม่ต้องมีกล้อง/หุ่นจริง ใช้ mock + aiosqlite)
cd backend && python -m pytest -q

# Frontend — 100 เคส
cd frontend && npm run test

# Lint + build
cd frontend && npm run lint && npm run build
```
> `requirements-dev.txt` **ไม่รวม `pyrealsense2`** โดยเจตนา เพราะเป็น hardware-only — ทำให้รันเทสต์ได้โดยไม่ต้องต่อกล้อง

---

## 3. ⚙️ ค่าที่ต้องตั้งก่อนรัน

| ไฟล์ | ตัวแปรสำคัญ | หมายเหตุ |
|---|---|---|
| `backend/.env` | `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `BLYNK_TOKEN` | ค่า DB มี default ใน compose แต่ **ต้องเปลี่ยน `JWT_SECRET`** ในเครื่องจริง |
| `backend/.maps_point.env` | `ROBOT_IP`, `DEPTH_CAM_SERIAL`, `WELD_TOOL_INDEX`, `HOME_*`, `DEPTH_ROI`, `MIN_DEPTH_MM`, `CAM_INTER_SYNC`, `CAM2_INTER_SYNC` | โหลดโดย `maps_point/config.py` ด้วย `override=True` |
| `frontend/.env` | `VITE_API_URL`, `VITE_WS_URL` | ตั้งตอน `docker compose build` |

**กล้องตัวที่สองไม่ได้ตั้งผ่าน env** — เลือกและจำค่าผ่าน API (`POST /api/camera/select` / `/swap`) แล้วบันทึกลง `backend/camera_selection.json` (state ของฮาร์ดแวร์ ไม่ใช่ per-user จึงอยู่นอก DB) backend จะอ่านไฟล์นี้ตอน boot เพื่อเปิดกล้องเดิม

> ไฟล์เหล่านี้อยู่ใน `.gitignore` และมีแต่ไฟล์ `.example` ใน git — **ห้าม commit ค่าจริง**

---

## 4. 🗺️ แผนที่โค้ด (สั้น ๆ สำหรับคนใหม่)

| ต้องแก้อะไร | ไปที่ไหน |
|---|---|
| API กล้อง/สตรีม | `backend/routers/camera.py`, `backend/routers/mapcontrol.py` |
| API หุ่น/align/draw | `backend/routers/mapcontrol.py` |
| อัลกอริทึมจับระนาบ | `backend/maps_point/align.py` + `planegrid.py` + `camera.py` |
| เชื่อม Dobot | `backend/maps_point/robot.py`, `dobot_api_v3.py` |
| 3D viewer | `frontend/public/robot-viewer.html` + `viewer-*.js` (แยกไฟล์แล้ว ไม่อยู่ใน html) |
| หน้าเว็บ | `frontend/src/pages/*.jsx` |
| เอกสารสถาปัตยกรรม | [BACKEND_CAMERA_DOBOT.md](BACKEND_CAMERA_DOBOT.md), [CAMERA_STREAM.md](CAMERA_STREAM.md) |

---

## 5. ⚠️ ความเสี่ยง / เรื่องที่ต้องระวัง

| # | เรื่อง | ผลกระทบ | สถานะ |
|---|---|---|---|
| 1 | **Tool 2 (probe tip) ยัง offset = 0** บน Dobot | `align` จะหมุนรอบ flange ไม่ใช่ปลายจริง → ตำแหน่ง XY เพี้ยน | ⏳ **ค้าง** ต้อง calibrate ใน DobotStudio Pro |
| 2 | **Model FK drift ~11 mm** เทียบ CR5 จริง | ปลายจริงไม่ตรงกับโมเดล (แก้บางส่วนด้วย `_ORIENT_FIX` ใน `viewer-ik.js`) | ⏳ ต้อง calibrate link length จาก CAD จริง |
| 3 | **Dobot ต่อ Pi ด้วย IP คนละซับเน็ต** (Pi `192.168.191.x`, หุ่น `192.168.10.110`) | ต้องต่อสาย/เราต์ร่วมให้ถึงกัน | ⚠️ ถ้าหลุดจะ connect ไม่ขึ้น |
| 4 | **web_robot กับ version_3.0 ใช้ Dobot/D455 พร้อมกันไม่ได้** | เปิดทั้งคู่แล้วกล้อง/หุ่นจะถูกจอง | ✅ ปิดอีกแอปก่อนเปิดอีกอัน |
| 5 | **DB ไม่มี migration** | `create_all` สร้างเฉพาะตารางใหม่ — เพิ่มคอลัมน์ใหม่ในโค้ดแล้ว DB เดิมจะไม่อัปเดต (ต้องรัน `ALTER TABLE` เอง เช่นที่เคยทำกับ `device_logs.detail`) | ⚠️ ระวังตอนขยาย schema |
| 6 | **Lint warning ~30 รายการ** | ตัวแปร/ฟังก์ชันที่ประกาศแล้วยังไม่ได้ใช้ ใน `viewer-scan-align.js`, `DrawingModePage.jsx` | 🟢 ไม่กระทบการทำงาน |

---

## 6. 📋 งานที่ค้างอยู่ (Next Steps)

- [ ] **Calibrate Tool 2 (probe tip)** บน DobotStudio Pro แล้วใส่ค่า offset กลับ — เป็นข้อ `WELD_TOOL_INDEX=2` ที่ผลกระทบสูงสุดต่อความแม่นของ align
- [ ] ปิดงาน 30 เคสที่ติด `Needs Rig` (ต้องต่อหุ่น/กล้องจริง) และ 19 เคสที่ยังไม่บันทึกผล
- [ ] ทดสอบ 7 เคส `Needs Browser` ในเบราว์เซอร์จริง (ไม่ใช่ headless)
- [ ] ตั้งค่า 3 เคส `Needs Config` (ตัวอย่าง: Cloudflare Tunnel, Blynk relay)
- [ ] ปรับ link length ของโมเดลให้ตรง CR5 จริง เพื่อแก้ FK drift
- [ ] เก็บ lint warnings (ไม่เร่งด่วน)
- [ ] อัปเดต `TEST_CASES.md` ให้ครอบคลุม 150 เคส (ปัจจุบันเป็นสเปก 102 เคสแรก)

---

## 7. 🧹 การจัดการไฟล์ (ที่ทำไว้ตอนส่งมอบ)

- กู้ `CAMERA_STREAM.md` คืนมาจาก stash (เคยถูก GitHub Desktop stash ทั้งที่)
- ย้ายไฟล์รุ่นเก่าไป **[archive/](archive/README.md)** (เก็บใน git history ไม่ได้ลบทิ้ง)
  - `TEST_CASES.csv` / `.xlsx` / `_SUMMARY.csv` — ชุด 102 เคสรุ่นแรก (แทนที่ด้วยชุด 150 เคส)
  - `models/Link6s.dae` — โมเดล 3.6 MB ที่ไม่มีโค้ดโหลด (`viewer-boot.js` โหลด `Link6_S.dae` แทน)
- อัปเดต `README.md` ให้เป็นดัชนีเอกสาร + sync โครงสร้างโปรเจกต์กับโค้ดจริง

---

## 8. 📞 ข้อมูลติดต่อ / สภาพแวดล้อมเครื่องจริง

| รายการ | ค่า |
|---|---|
| เครื่อง deploy | Raspberry Pi 5 · `192.168.191.125` |
| โฟลเดอร์ deploy | `/home/pi/thesis_robot/web_robot_30_9_2026_19_37_00` |
| หุ่น | Dobot CR5 · `192.168.10.110` (พอร์ต 29999 dashboard / 30003-30004 move) |
| กล้อง | Intel RealSense D455 × 2 |
| Cloudflare Tunnel | `cloudflared` รันแยกนอก docker stack (ไม่ได้อยู่ใน `docker-compose.yml`) — deploy บน Pi ครับ |

> ⚠️ รายละเอียดการเชื่อมต่อ/รหัสผ่านเครื่องจริง **ไม่ถูก commit** ใน git (เก็บใน `PI5.md` ซึ่งอยู่ใน `.gitignore`)