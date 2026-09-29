# 🧪 Test Cases — Web Robot (Control Center & Dashboard)

> เอกสารชุด Test Case สำหรับทดสอบระบบ Web Robot (Dobot CR5 + RealSense D455)
> ครอบคลุมทั้ง **manual test case** (ทดสอบผ่าน UI/API) และ **automated test** (unit test ที่มีอยู่)

**Environment ที่ใช้ทดสอบ**
- Frontend: `http://<PI_IP>` (nginx) หรือ `http://localhost:5173` (dev)
- Backend: `http://<PI_IP>:8000` · Swagger: `/docs`
- Robot: Dobot CR5 (`ROBOT_IP`) · Camera: RealSense D455 (`DEPTH_CAM_SERIAL`)

**สัญลักษณ์**
- 🟢 Automated (มี unit test รันอัตโนมัติอยู่แล้ว)
- 🔵 Manual (ต้องทดสอบกับ hardware/UI จริง)

---

## 1. Authentication & Session

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| AUTH-01 | Login สำเร็จ | มี user ใน DB | POST `/api/auth/login` body `{username, password}` ถูกต้อง | 200 + `access_token` (JWT, exp 72 ชม.) + `token_type=bearer` + `username` |
| AUTH-02 | Login รหัสผิด | มี user | POST ด้วย password ผิด | 401 "Invalid credentials" |
| AUTH-03 | Login user ไม่มี | – | POST ด้วย username ที่ไม่มี | 401 "Invalid credentials" |
| AUTH-04 | เข้าหน้าป้องกันโดยไม่มี token | ล้าง `localStorage.access_token` | เปิด `/dobot`, `/camera`, `/drawing`, `/settings`, `/dashboard` | เด้งไป `/login` (RequireAuth) |
| AUTH-05 | token หมดอายุ | token exp ผ่านไปแล้ว | เปิดหน้า protected | เด้งไป `/login` |
| AUTH-06 | token เสียรูป | ใส่ token มั่ว | GET `/api/auth/me` | 401 |
| AUTH-07 | `/me` ไม่มี header | – | GET `/api/auth/me` | 401 |
| AUTH-08 | `/me` token ถูกต้อง | login แล้ว | GET `/api/auth/me` พร้อม Bearer | 200 + `{id, username}` |
| AUTH-09 | Register ต้อง login ก่อน | – | POST `/api/auth/register` ไม่มี token | 401 |
| AUTH-10 | Register username สั้น | login อยู่ | POST register `username="a"` | 400 |
| AUTH-11 | Register password สั้น | login อยู่ | POST register `password="x"` | 400 |
| AUTH-12 | Register username ซ้ำ | มี user "admin" | POST register `username="admin"` | 409 |
| AUTH-13 | Register สำเร็จ | login อยู่ | POST register user ใหม่ (username≥2, password≥4) | 200 + token + username |
| AUTH-14 | Logout | login อยู่ | กด Logout | ล้าง token, เด้งไป `/login` |

## 2. API Client / Error Handling (Frontend)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| API-01 | 🟢 แนบ Bearer อัตโนมัติ | มี token | เรียก `apiFetch` | request มี header `Authorization: Bearer <token>` |
| API-02 | 🟢 ไม่ทับ Authorization ที่ส่งมาเอง | มี token | `apiFetch(url,{headers:{Authorization:'Bearer x'}})` | ใช้ค่า `Bearer x` ที่ส่งมา |
| API-03 | 🟢 GET เจอ 5xx → retry 1 ครั้ง | mock server คืน 500 | `apiFetch` (GET) | ยิงซ้ำ 1 ครั้ง (รวม 2 ครั้ง) |
| API-04 | 🟢 5xx → แสดง banner | – | เกิด 5xx | dispatch `api:server-error` → `ApiErrorBanner` ขึ้นข้อความ |
| API-05 | 🟢 401 (protected) → เด้ง login | อยู่หน้า `/dobot` | เรียก endpoint ที่คืน 401 | clear token + `location.replace('/login')` |
| API-06 | 🟢 401 จาก `/api/auth/*` ไม่เด้ง | – | POST `/api/auth/login` คืน 401 | ไม่ redirect |
| API-07 | 🔵 Banner auto-hide | – | ให้เกิด 5xx แล้วรอ 8 วิ | banner หายเอง (หรือกดปุ่ม ✕ ปิดได้) |

## 3. Dashboard

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| DASH-01 | 🔵 แสดงสถานะเชื่อมต่อ | login แล้ว | เปิด `/dashboard` | แสดงสถานะ robot/camera/ระบบ |
| DASH-02 | 🔵 อัปเดต realtime | ต่อหุ่นจริง | เฝ้าหน้า 2–3 วิ | ข้อมูลอัปเดตจาก `/api/map/status` (poll) |
| DASH-03 | 🔵 ระบบออฟไลน์ | ปิดหุ่น/กล้อง | เปิด dashboard | แสดงสถานะ Disconnected ไม่ค้าง |

## 4. Dobot Controller (`/dobot`)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| DOB-01 | 🔵 Jog Cartesian | ต่อหุ่นแล้ว | เลือกแกน X, step=1, กด + / − | หุ่นขยับทีละ 1mm (`POST /api/map/jog`) |
| DOB-02 | 🔵 Jog Joint | ต่อหุ่น | เลือก J1, step, กด + / − | ข้อต่อขยับ (`POST /api/map/jog_joint`) |
| DOB-03 | 🔵 เลือก step 0.1/1/5/10 | – | เปลี่ยนค่า step แล้ว jog | ระยะขยับตรงกับ step |
| DOB-04 | 🔵 Live coordinate | ต่อหุ่น | ดูแถบพิกัด | แสดง X/Y/Z/RX/RY/RZ + J1–J6 realtime |
| DOB-05 | 🔵 3D Viewer sync | เปิด `/dobot` | ดูโมเดล 3D | ท่าทางโมเดลตรงกับพิกัดจริง |
| DOB-06 | 🔵 IK drag end-effector | เปิด viewer | ลากลูกบอลปลายแขน | ทุกข้อต่อขยับตาม (CCD IK) |
| DOB-07 | 🔵 Home | ต่อหุ่น | กดปุ่ม Home | POST `/api/map/home` → หุ่นไป HOME_* |
| DOB-08 | 🚨 Emergency Stop | ต่อหุ่น | กดปุ่ม E-Stop | POST `/api/map/emergency` → หยุดทันที + cancel align/draw |
| DOB-09 | 🔵 Error clear | หุ่น error | POST `/api/map/error` | เคลียร์ error (`robot.clear_error`) |
| DOB-10 | 🔵 Connect / Init / CamStart | – | กดปุ่มเชื่อมต่อ/init/start cam | endpoint ทำงาน, สถานะเปลี่ยนเป็น connected |
| DOB-11 | 🔵 CLI command | ต่อหุ่น | ส่งคำสั่งผ่าน CLI | POST `/api/map/cli` → ผลลัพธ์แสดงกลับ |

## 5. Camera (`/camera`)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| CAM-01 | 🔵 Live MJPEG | กล้องทำงาน | เปิด `/camera` | เห็นภาพสด (`GET /api/map/video_feed` / `/api/camera/stream`) |
| CAM-02 | 🔵 Snapshot | กล้องทำงาน | กด Capture | ได้ไฟล์ JPEG (`GET /api/camera/snapshot`) |
| CAM-03 | 🔵 สลับโหมด rgb/gray/depth | กล้องทำงาน | กดปุ่มโหมด | ภาพเปลี่ยนโหมด (`POST /api/camera/mode`) |
| CAM-04 | 🔵 Mode toggle | – | กด toggle | วนโหมด (`POST /api/camera/mode/toggle`) |
| CAM-05 | 🔵 ตรวจกล้องที่ต่ออยู่ | – | เปิดหน้า/กด scan | `GET /api/camera/devices` แสดง serial ทั้งหมด |
| CAM-06 | 🔵 กล้องตัวที่ 2 (CAM2) | มี D455 2 ตัว | เปิด stream2 | เห็นภาพกล้องที่ 2 (`GET /api/camera/stream2`) |
| CAM-07 | 🔵 Swap view | มี 2 กล้อง | กด Swap View | สลับภาพกล้องหลัก/รอง (`POST /api/camera/swap`) |
| CAM-08 | 🔵 เลือกกล้อง primary | มีหลายกล้อง | POST `/api/camera/select` | กล้องหลักเปลี่ยนตามที่เลือก |
| CAM-09 | 🔵 Snap กล้อง 2 | มี 2 กล้อง | GET `/api/camera/snapshot2` | ได้ภาพจากกล้อง 2 |
| CAM-10 | 🔵 Snapshot แปะ marking | มีจุด mark | กด Capture | ภาพที่ได้มีจุด mark ตรงกับที่เห็น |

## 6. Drawing Mode (`/drawing`)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| DRAW-01 | 🔵 ตั้งขนาด grid | เปิด `/drawing` | POST `/api/map/grid/size` rows/cols | รับค่า rows/cols (≤ 7×7) |
| DRAW-02 | 🔵 Mark จุด grid | jog หุ่นไปจุด | กด Mark ทีละมุม | `POST /api/map/grid/mark` เก็บ pose |
| DRAW-03 | 🔵 Validate grid | mark ครบ | ดูผล validate | แจ้งเตือนถ้า span เล็กไป หรือ rmse > 3mm |
| DRAW-04 | 🔵 Auto-fill Z | mark แล้ว | กด Autofill | `POST /api/map/grid/autofill` เติม Z ตามพื้นผิว |
| DRAW-05 | 🔵 Reset grid | มี grid | กด Reset | `POST /api/map/grid/reset` ล้าง grid |
| DRAW-06 | 🔵 Restore grid | มี pose ครบ | POST `/api/map/grid/restore` | grid กลับมาตั้งได้โดยไม่ต้องสอนใหม่ |
| DRAW-07 | 🔵 Return-to-start | วาดจบ | สังเกตหลังวาด | หัวหุ่นกลับไปจุดเริ่ม (ไม่ค้างที่จุดสุดท้าย) |
| DRAW-08 | 🔵 วาดเส้น (pen) | grid ครบ | วาดบน canvas แล้ว Send | หุ่นวาดตามเส้นบนพื้นผิวจริง (`POST /api/map/draw`) |
| DRAW-09 | 🔵 หยุดกลางการวาด | กำลังวาด | กด Stop | `POST /api/map/draw/stop` → หยุดทันที |
| DRAW-10 | 🔵 Pen-lift ระหว่างรูป | วาด 2 รูป | ส่งหลาย stroke | ยกหัวหุ่นก่อนข้ามไปรูปถัดไป |
| DRAW-11 | 🔵 Goto / Point (mark click) | ต่อหุ่น | กดจุดบนภาพ | `POST /api/map/goto` หรือ `/point` ทำงานตามโหมด |
| DRAW-12 | 🔵 Frame control | ต่อหุ่น | เปลี่ยน frame (User/Tool) | `POST /api/map/frame` เปลี่ยน coordinate |

### 6.1 Robot & Teach Panel (tabbed — อัปเดต 2026-09-29)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| TP-01 | 🔵 สลับแท็บ panel | เปิด `/drawing` | กดแท็บ Align / Grid / Jog / All | เนื้อหา panel เปลี่ยนตามแท็บที่เลือก (แสดงเฉพาะการ์ดของแท็บนั้น) |
| TP-02 | 🔵 พับ/กาง panel | – | กดปุ่ม Fold | panel ย่อ/ขยาย (isTeachMinimized) และปุ่มเปลี่ยน label |
| TP-03 | 🔵 Status pills | ต่อหุ่น | ดู pills ด้านบน panel | แสดงสถานะเชื่อมต่อ/โหมดหุ่นถูกต้อง |
| TP-04 | 🔵 Quick actions | ต่อหุ่น | กด Connect / Init / CamStart / Heatmap | เรียก endpoint ตรง (connect/init/camstart/heatmap toggle) |
| TP-05 | 🔵 Grid Setup (rows×cols) | – | เปลี่ยน rows/cols ในแท็บ Grid | ขนาด grid อัปเดต (`grid/size`) ≤ 7×7 |
| TP-06 | 🔵 Cells Matrix & Shape | mark ครบ | ดูการ์ด Cells Matrix | แสดง preview รูปร่าง grid ตามที่สอน (`grid_shape_2d`) |
| TP-07 | 🔵 Jog ใน panel | ต่อหุ่น | ใช้ปุ่ม jog ในแท็บ Jog | ยิง `POST /api/map/jog` / `jog_joint` ตามแกน/step |
| TP-08 | 🔵 Motion / Step controls | – | ปรับ step/speed | ค่า step/speed ถูกส่งตอน jog |
| TP-09 | 🔵 Corner Alignment (4 points) | mark 4 มุม | กด Align ในแท็บ Align | `POST /api/map/align` เริ่ม align |
| TP-10 | 🔵 Coordinate Frame (panel) | ต่อหุ่น | เปลี่ยน frame | `POST /api/map/frame` เปลี่ยน coordinate |
| TP-11 | 🔵 3D viewer มุมล่างซ้าย | เปิด `/drawing` | สังเกตตำแหน่ง viewer | viewer อยู่มุมล่างซ้ายของหน้า |

## 7. Align / Calibration

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| ALN-01 | 🔵 Start align | mark 4 จุด + กล้อง depth | กด Start Align | `POST /api/map/align` เริ่ม rotate ให้ระนาบตรง |
| ALN-02 | 🔵 Align converge | เริ่มแล้ว | เฝ้า status | tilt ลดลงจน ≤ ALIGN_TOL_DEG แล้วหยุด |
| ALN-03 | 🔵 หยุด align | กำลัง align | กด Stop | `POST /api/map/align/stop` → หยุด |
| ALN-04 | 🔵 กัน points ไม่ lock | mark ยังไม่ติด | เริ่ม align | retry สั้น ๆ แล้วแจ้ง "points not locked" |
| ALN-05 | 🔵 Reset points | มีจุด mark | กด Clear | `POST /api/map/reset_points` |
| ALN-06 | 🔵 Heatmap toggle | depth ทำงาน | กด toggle | `POST /api/map/heatmap/toggle` |

## 8. Move / Sequence

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| MOV-01 | 🔵 Move to pose | ต่อหุ่น | POST `/api/map/move_to` | หุ่นเคลื่อนไป pose ที่ระบุ |
| MOV-02 | 🔵 Move sequence | ตั้งลำดับแล้ว | POST `/api/map/move_sequence` | วิ่งตามลำดับ |
| MOV-03 | 🔵 หยุด sequence | กำลังวิ่ง | POST `/api/map/move_sequence/stop` | หยุดทันที |
| MOV-04 | 🔵 `/api/robot/move` | ต่อหุ่น | POST `{axis,direction,step}` | ขยับตามที่สั่ง |
| MOV-05 | 🚨 `/api/robot/emergency-stop` | ต่อหุ่น | POST | หยุดฉุกเฉิน |

## 9. Settings & Devices

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| SET-01 | 🔵 โหลด settings | login | เปิด `/settings` | `GET /api/settings` แสดงค่า |
| SET-02 | 🔵 แก้ settings | – | PUT `/api/settings` | บันทึกค่าใหม่ |
| SET-03 | 🔵 แก้ราย key | – | PUT `/api/settings/{key}` | อัปเดตเฉพาะ key |
| DEV-01 | 🔵 Relay toggle | มี Blynk token | POST `/api/devices/relay/toggle` | สลับ relay สำเร็จ |
| DEV-02 | 🔵 Relay state | – | GET `/api/devices/relay/state` | คืนสถานะปัจจุบัน |
| DEV-03 | 🔵 Relay history | – | GET `/api/devices/relay/history` | คืนประวัติการสั่ง |
| DEV-04 | 🔵 Ping device | – | GET `/api/devices/ping` | คืนสถานะ reachable |

## 10. Security / Middleware

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| SEC-01 | 🔵 บังคับ Bearer ทุก `/api/*` | – | เรียก `/api/map/status` ไม่มี token | 401 (middleware) ยกเว้น `/api/auth/*` |
| SEC-02 | 🔵 CORS ตาม `ALLOWED_ORIGINS` | ตั้ง env | ยิงจาก origin ที่อนุญาต/ไม่อนุญาต | อนุญาตเฉพาะ origin ในลิสต์ |
| SEC-03 | 🔵 OPTIONS ไม่ถูกบล็อก | – | preflight OPTIONS | ผ่าน (ไม่โดน 401) |
| SEC-04 | 🔵 Root health | – | GET `/` | 200 `{"message":"Robot Arm API is running"}` |

---

## 11. Automated Unit Tests (รันอัตโนมัติอยู่แล้ว)

### Backend — `pytest` (`backend/tests/`)
| No | Test Case | ไฟล์ |
|---|---|---|
| 🟢 BE-01 | `bilinear_cell` — มุม/กลาง/ยังอยู่บนระนาบ | `test_planegrid.py` |
| 🟢 BE-02 | `grid_pose` — clamp, 2×2, 3×3 | `test_planegrid.py` |
| 🟢 BE-03 | `validate_grid` — flat / span เล็ก / ไม่ coplanar | `test_planegrid.py` |
| 🟢 BE-04 | `project_grid_2d` — shape + ทิศทาง | `test_planegrid.py` |
| 🟢 BE-05 | `_cap_points` / `densify_path` / `simplify_stroke` | `test_planegrid.py` |
| 🟢 BE-06 | `config` — default, env override, type coercion, mode lowercase, Z_SURFACE | `test_config.py` |
| 🟢 BE-07 | `models` — UUID default, username unique, setting unique, relationship, device log | `test_models.py` |
| 🟢 BE-08 | `auth` — token roundtrip, bcrypt, login/`me`/register | `test_auth.py` |

### Frontend — `vitest` (`frontend/src/**/*.test.*`)
| No | Test Case | ไฟล์ |
|---|---|---|
| 🟢 FE-01 | token storage / `isTokenValid` / `authHeaders` / `redirectToLogin` | `lib/api.test.js` |
| 🟢 FE-02 | `apiFetch` — bearer, retry GET 5xx, event, 401 redirect | `lib/api.test.js` |
| 🟢 FE-03 | `ApiErrorBanner` — แสดง/ปิด/auto-hide | `components/ApiErrorBanner.test.jsx` |
| 🟢 FE-04 | `RequireAuth` — redirect / render | `components/RequireAuth.test.jsx` |

### วิธีรัน
```bash
# backend
cd backend && .venv/bin/python -m pytest

# frontend
cd frontend && npm run test
```

---

## 12. Test Summary Template

| Module | Total | Pass | Fail | Blocked | หมายเหตุ |
|---|---|---|---|---|---|
| Auth | 14 | | | | |
| API Client | 7 | | | | |
| Dashboard | 3 | | | | |
| Dobot | 11 | | | | |
| Camera | 10 | | | | |
| Drawing | 23 | | | | |
| Align | 6 | | | | |
| Move | 5 | | | | |
| Settings/Devices | 7 | | | | |
| Security | 4 | | | | |
| Automated (BE+FE) | 12 | | | | |
| **รวม** | **102** | | | | |
