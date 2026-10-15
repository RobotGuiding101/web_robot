# 📝 Work Log — Robot Viewer / Tool Tip (2026-10-04)

> บันทึกงาน session นี้ เพื่อทำต่อได้ — branch: `dev-back-test`

---

## 🎯 เป้าหมาย session นี้
- ทำ gizmo/tool tip ใน 3D viewer (`robot-viewer.html`) ให้ **ลากจากปลาย tool จริง** และ **Move แล้วปลายไปตรงเป้า**
- ทำค่า readout ของปลาย (TIP) ให้แม่น
- ตรวจค่า Tool coordinate ที่ตั้งบนหุ่นจริง

---

## 🗺️ สภาพแวดล้อม / ที่ตั้ง
| อะไร | ค่า |
|---|---|
| Repo | `RobotGuiding101/web_robot` branch `dev-back-test` |
| Pi | `pi@192.168.191.125` (รหัสผ่านดูใน `PI5.md` ซึ่งอยู่ใน `.gitignore` — **ห้าม commit**) |
| Deploy dir (ที่รันจริง) | `~/thesis_robot/web_robot_30_9_2026_19_37_00` |
| Docker stack | `robot_frontend`, `robot_backend`, `robot_postgres`, `robot_adminer`, `cloudflared` |
| Robot (Dobot CR5) | `192.168.10.110` (ตั้งใน `backend/.env` + `backend/.maps_point.env`) |
| หมายเหตุ IP | เดิมหุ่นเคยเป็น `.98`; หลัง reboot ขึ้น `.110` (ตรงกับ `.env`) |

### วิธี deploy ขึ้น Pi (ที่ใช้ session นี้)
```bash
# ก๊อปไฟล์ที่แก้เข้า deploy dir แล้ว rebuild เฉพาะ frontend
sshpass -p '<PI_PASSWORD>' scp frontend/public/robot-viewer.html \
  pi@192.168.191.125:~/thesis_robot/web_robot_30_9_2026_19_37_00/frontend/public/robot-viewer.html
sshpass -p '<PI_PASSWORD>' ssh pi@192.168.191.125 \
  "cd ~/thesis_robot/web_robot_30_9_2026_19_37_00 && docker compose build frontend && docker compose up -d frontend"
# (ถ้าแก้ src/ ใช้ docker compose up -d --build แทน)
```

---

## ✅ งานที่ทำไปแล้ว (commits)
- **`313185a`** `feat(viewer): rename Link6 model to Link6s.dae and force pure red link6`
  - เปลี่ยนชื่อ model `Link6.dae` → `Link6s.dae` + แก้ path ใน viewer
  - ย้อมทุก mesh ของ Link6s เป็น **แดงสด** ด้วย `MeshBasicMaterial` (สี `0xff0000`, `DoubleSide`) — ไม่ขึ้นกับแสง
  - **ปิด light + camera ที่ฝังมาในไฟล์ DAE** (`child.isLight/isCamera → visible=false`) เพราะมีไฟสีฟ้า 14 ตัวสาดล้างสี
  - แผง `Cam1 mount` / `Cam2 extrinsic` เริ่มต้นซ่อน; ปุ่ม ⚙ Tune สลับทั้งสองแผงพร้อมกัน (ปุ่มคงความโปร่งใส)
- **`41562fd`** `feat(robot-viewer): accurate tool tip (robot-pose based) + Tip readout`
  - `_postTargetPose()` ส่งพิกัด **flange (`endEffector`)** แทนปลาย → เวลา Move ปลาย tool ไปตรงจุดที่ลาก
  - ช่อง readout **TIP** คำนวณจาก **pose จริงของหุ่น** (`GetPose`) ตอน Get Pos ON, และจากโมเดลตอนลาก (OFF)
  - เพิ่ม `MODEL_TO_ROBOT_OFFSET` จูน + `_ORIENT_FIX` (residual องศา)

---

## 🔧 จุดที่แก้ในโค้ด (สำคัญ)

### `frontend/public/robot-viewer.html`
| จุด | ค่า/พฤติกรรม |
|---|---|
| `gizmoTip.position` | `(0.0899, 0.0077, 0.0686)` = ปลาย tool ที่พิมพ์ 3D (ใน frame ของ link6) — **ลากจากปลายนี้** |
| Link6s material | `MeshBasicMaterial{ color:0xff0000, side:DoubleSide }` + ปิด light/camera ใน DAE |
| `_postTargetPose()` | ส่ง **flange** (`endEffector.getWorldPosition`) เพื่อให้ปลายไปตรงเป้า |
| `tcpUpdate` | ส่ง `x,y,z,rx,ry,rz` (flange จากโมเดล) + `tipX,tipY,tipZ` |
| TIP (Get Pos ON) | `tip = GetPose.xyz + R(robot euler) × (TOOLFIX⁻¹ × gizmoTip)` — คำนวณจากหุ่นจริง เลี่ยง FK drift ของโมเดล |
| TIP (OFF/ลาก) | ใช้ `gizmoTip.getWorldPosition()` ผ่านโมเดล |
| `_modelToRobot` | `MODEL_TO_ROBOT_OFFSET = {x:-40.65, y:-23.19, z:-7.43}` |
| `_modelOrientToRobot` | `_ORIENT_FIX = {rx:0.01, ry:0.27, rz:0.11}` |
| `latestRealPose` | ดึง `pose` จาก `/ws/joints` (และจาก `setJoints.realPose` ถ้ามี) — เก็บเป็น array [x,y,z,rx,ry,rz] |

### `frontend/src/pages/DobotControllerPage.jsx`
- เพิ่ม state `tipPos` + รับ `tipX/tipY/tipZ` จาก `tcpUpdate` (อัปเดตตลอด ไม่ขึ้นกับ Get Pos)
- เพิ่มกลุ่ม readout **"Tip — ปลายแหลม (mm)"** (จุดสีส้ม) ต่อจาก Cartesian

---

## 🔬 ผลการตรวจหุ่นจริง (สำคัญมาก)
อ่านผ่าน **feedback port 30004** (field `tool[6]`) ด้วยสคริปต์ชั่วคราว (ลบแล้ว):
```
Tool(0) ack=0  tool[6] = [0,0,0,0,0,0]
Tool(1) ack=0  tool[6] = [0,0,0,0,0,0]
Tool(2) ack=0  tool[6] = [0,0,0,0,0,0]
Tool(3) ack=-1 (ไม่มี)
```
**ข้อสรุป:**
- **Tool 1 และ Tool 2 บนหุ่น = 0 (ไม่ได้ calibrate)** → controller ไม่รู้ offset ปลาย tool
- `GetPose` **ไม่สนใจ Tool frame** (เลือก Tool แล้วค่าเท่าเดิม) — มีแต่ `User` ที่เปลี่ยน frame (ตรงกับคอมเมนต์ใน `robot.py`)
- เพราะฉะนั้น offset ปลาย tool อาศัยอยู่แค่ใน **โมเดล 3D (`gizmoTip`)** เท่านั้น

⚠️ **ผลกระทบ**: โค้ด align ใช้ `rel_movl_tool(tool=WELD_TOOL_INDEX=2)` หมุนรอบ probe tip — แต่ถ้า Tool 2 = 0 จุดหมุนจริงจะเป็น **flange ไม่ใช่ปลาย** → ควรไปตั้งค่า **Tool 2 (probe tip)** ใน DobotStudio Pro

---

## 📊 พฤติกรรม Get Pos ON vs OFF (อธิบายไว้)
- **ON** → readout มาจาก `/api/map/status` (`robot.get_pose()`) + `/ws/joints`
- **OFF** → `DobotControllerPage.jsx:428` handler `tcpUpdate` เขียนทับ `pos` จากโมเดล (เฉพาะตอน OFF) → ใช้ลาก/วางแผน
- ค่าอาจต่างกันเล็กน้อย (FK ของโมเดล ≠ แขนจริง) — ตอนนี้ TIP แก้ให้ใช้หุ่นจริงแล้ว

---

## ⚠️ ข้อจำกัด / เรื่องที่ยังเหลือ
1. **Model FK drift**: ปลายที่คำนวณจากโมเดลเพี้ยนได้ ~11mm ที่บางท่า (ความยาว link ใน DAE ≠ CR5 จริง) — เลี่ยงแล้วด้วยการคำนวณ TIP จาก pose หุ่นตอน ON
2. TIP จาก pose หุ่น ยังคลาด ~0.5mm (ไม่รวม `_ORIENT_FIX`) — จูนต่อได้ถ้าต้องการ
3. **Tool 2 = 0** → ถ้าจะให้ align หมุนรอบปลายจริง ต้องตั้ง Tool 2 ก่อน
4. Residual เป็น **ค่าคงที่** (จูน ณ ท่าหนึ่ง) — ถ้าต้องการเป๊ะทุกท่า ต้องคาลิเบรตหลายจุด/แก้ DH ของโมเดล

---

## 👉 งานต่อที่แนะนำ
- [ ] ตั้ง **Tool 2 (probe tip)** ใน DobotStudio Pro แล้วทดสอบ align (pivot ควรเป็นปลาย)
- [ ] ทดสอบ TIP ON/OFF ที่หลายๆ orientation เพื่อยืนยัน residual
- [ ] (ถ้าต้องการ) ทำ calibration แบบหลายจุด / ปรับ link length ของโมเดล `Link1-6.dae`
- [ ] พิจารณา commit การแก้ `frontend/src/pages/DobotControllerPage.jsx` ร่วม (ทำแล้วใน 41562fd)

---

## 🧾 หมายเหตุการทดสอบ
- ทุกครั้งที่แก้ frontend ต้อง **`docker compose build frontend && up -d frontend`** แล้ว **hard refresh (Ctrl+F5)** เพราะ `robot-viewer.html` เป็น iframe
- ตรวจว่า serve แล้วได้โค้ดใหม่: `curl -s http://localhost/robot-viewer.html | grep <marker>`

---
---

# 📝 Work Log — เอกสาร & ส่งมอบงาน (2026-10-15)

> Session ปิดงาน เพื่อจัดไฟล์ให้พร้อมส่งต่อ — branch `main` (PR #3 รวม `dev-back-test` แล้ว) · commit ก่อน session นี้ `3e84f59`

## 🎯 เป้าหมาย
- ตรวจสุขภาพโปรเจคก่อนส่งต่อ (เทสต์ / lint / build)
- เก็บเอกสารที่หาย + จัดโครงสร้างรากโปรเจคให้อ่านง่าย
- เขียนเอกสารส่งมอบ (HANDOFF)

---

## 🔍 สิ่งที่ตรวจพบ

| # | เรื่อง | ผล |
|---|---|---|
| 1 | `CAMERA_STREAM.md` หายไป | ถูก GitHub Desktop stash ทั้งที่ → กู้คืนจาก `stash@{0}` แล้ว |
| 2 | `frontend/public/models/Link6s.dae` (~3.6 MB) | **ไม่มีโค้ดโหลด** — `viewer-boot.js:425` โหลด `Link6_S.dae` แทน → ย้ายเข้า `archive/models/` |
| 3 | `TEST_CASES.xlsx` / `TEST_CASES.csv` (102 เคส) | ถูกแทนที่ด้วยชุด 150 เคส (`TEST_CASES_new.xlsx`, `evidence/test_cases_verified.csv`) → ย้ายเข้า `archive/test-cases-v102/` |
| 4 | `TEST_CASES_SUMMARY.csv` | คอลัมน์ Pass/Fail ว่างทั้งหมด (ไม่มีผลจริง) → ย้ายเข้า `archive/` |
| 5 | **รหัสผ่าน Pi ถูก commit ใน `WORK_LOG.md`** (3 จุด) | ลบออกจากไฟล์ → เหลือ `<PI_PASSWORD>` / ชี้ไป `PI5.md` (อยู่ใน `.gitignore`) |
| 6 | README โครงสร้างโปรเจกต์ไม่ตรงโค้ดจริง | ขาด `viewer-*.js` (7 ไฟล์), `scan.py`, `LogsPage.jsx`, `shapes.js`, `robotLogFormat.js`, `reportGate.js`, `RobotLogPanel.jsx` → sync แล้ว |
| 7 | README เขียนว่า "ชุดทดสอบ 102 เคส" | ชุดที่รันจริง = **150 เคส** (102 เดิม + 48 ใหม่) → แก้ตัวเลข + ชี้ไฟล์ผลจริง |
| 8 | `TEST_CASES.md` ยังเป็นสเปก 102 เคส | ครอบคลุมครบทุกเคสในชุด 150 แต่ขาด 48 เคสใหม่ → ค้างไว้ในรายการงาน |

---

## ✅ ผลตรวจสุขภาพ (รันจริง)

| รายการ | คำสั่ง | ผล |
|---|---|---|
| Backend tests | `cd backend && python -m pytest -q` | ✅ **158 passed** |
| Frontend tests | `cd frontend && npm run test` | ✅ **100 passed** (7 files) |
| Lint | `cd frontend && npm run lint` | ✅ ไม่มี error (warning ~30 เรื่อง = ตัวแปรที่ยังไม่ได้ใช้) |
| Build | `cd frontend && npm run build` | ✅ สำเร็จ (bundle 665 kB / gzip 201 kB) |
| Git hygiene | `git status` / `git ls-files` | ✅ ไม่มี secret/ไฟล์ cache ติด git · ไม่มี untracked ค้าง · repo 25.5 MB |
| Encoding | ตรวจทุกไฟล์ `.md` / `.csv` | ✅ UTF-8 ทั้งหมด (CSV มี BOM, MD ไม่มี) |

---

## 📁 ไฟล์ที่เพิ่ม/ย้าย

```
+ CAMERA_STREAM.md          (กู้คืนจาก stash — สรุปกล้อง/การเชื่อม/MJPEG/pyrealsense2+OpenCV)
+ HANDOFF.md                (ใหม่ — จุดส่งมอบงาน)
+ archive/README.md         (ใหม่ — อธิบายไฟล์ที่ย้าย + วิธีคืน)
~ README.md                 (เพิ่มดัชนีเอกสาร + sync โครงสร้าง + แก้ตัวเลข 102→150)
~ WORK_LOG.md               (ลบรหัสผ่าน + เพิ่มบันทึก session นี้)
rename TEST_CASES.csv              → archive/test-cases-v102/
rename TEST_CASES.xlsx             → archive/test-cases-v102/
rename TEST_CASES_SUMMARY.csv      → archive/test-cases-v102/
rename models/Link6s.dae           → archive/models/
```

---

## ⚠️ ความเสี่ยงที่เหลือ (ส่งต่อต้องบอก)

1. **Tool 2 (probe tip) = offset 0** — ผลกระทบสูงสุดต่อความแม่นของ align (หมุนรอบ flange ไม่ใช่ปลายจริง)
2. **รหัสผ่าน Pi ยังอยู่ใน git history** แม้ลบจากไฟล์แล้ว (commit `f5a1c72`) — **ควรเปลี่ยนรหัสผ่าน** หรือใช้ `git filter-repo` หาก repo เป็น public
3. **Model FK drift ~11 mm** — ต้อง calibrate link length จาก CAD จริง
4. **DB ไม่มี migration** — เพิ่มคอลัมน์ต้อง `ALTER TABLE` เอง
5. **web_robot กับ version_3.0 จอง Dobot/D455 ได้ทีละแอป**

---

## 👉 งานต่อ (สรุปทั้งหมด)

- [ ] เปลี่ยนรหัสผ่าน Pi / ล้างรหัสผ่านออกจาก git history
- [ ] ตั้ง **Tool 2 (probe tip)** ใน DobotStudio Pro แล้วทดสอบ align ซ้ำ
- [ ] ปิดงาน 30 เคส `Needs Rig` + 19 เคสที่ยังไม่บันทึกผล + 7 เคส `Needs Browser` + 3 เคส `Needs Config`
- [ ] อัปเดต `TEST_CASES.md` ให้ครอบคลุม 150 เคส
- [ ] calibrate link length ของโมเดลให้ตรง CR5 จริง
- [ ] เก็บ lint warnings (~30 รายการ)
