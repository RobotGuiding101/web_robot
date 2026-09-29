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
| AUTH-01 | Login สำเร็จ | มี user ใน DB | 1. เปิดหน้า /login<br>2. กรอก username และ password ที่มีในระบบ<br>3. กดปุ่ม Login | 200 + `access_token` (JWT, exp 72 ชม.) + `token_type=bearer` + `username` |
| AUTH-02 | Login รหัสผิด | มี user | 1. เปิดหน้า /login<br>2. กรอก username ถูก แต่ password ผิด<br>3. กดปุ่ม Login | 401 "Invalid credentials" |
| AUTH-03 | Login user ไม่มี | – | 1. เปิดหน้า /login<br>2. กรอก username ที่ไม่มีในระบบ<br>3. กดปุ่ม Login | 401 "Invalid credentials" |
| AUTH-04 | เข้าหน้าป้องกันโดยไม่มี token | ล้าง `localStorage.access_token` | 1. ล้าง token (logout หรือลบ localStorage)<br>2. พิมพ์ URL เช่น /dobot แล้วกด Enter<br>3. ทำซ้ำกับ /camera, /drawing, /settings, /dashboard | เด้งไป `/login` (RequireAuth) |
| AUTH-05 | token หมดอายุ | token exp ผ่านไปแล้ว | 1. ใช้ token ที่หมดอายุแล้ว<br>2. เปิดหน้า protected เช่น /dobot | เด้งไป `/login` |
| AUTH-06 | token เสียรูป | ใส่ token มั่ว | 1. ใส่ token ที่ผิดรูปแบบ<br>2. เปิดหน้า protected หรือเรียก /api/auth/me | 401 |
| AUTH-07 | `/me` ไม่มี header | – | 1. ไม่แนบ header Authorization<br>2. เรียก GET /api/auth/me | 401 |
| AUTH-08 | `/me` token ถูกต้อง | login แล้ว | 1. Login ให้ได้ token<br>2. เรียก GET /api/auth/me พร้อม Bearer token | 200 + `{id, username}` |
| AUTH-09 | Register ต้อง login ก่อน | – | 1. ไม่ login (ไม่มี token)<br>2. เรียก POST /api/auth/register | 401 |
| AUTH-10 | Register username สั้น | login อยู่ | 1. Login ก่อน<br>2. เรียก register ด้วย username ยาว 1 ตัวอักษร | 400 |
| AUTH-11 | Register password สั้น | login อยู่ | 1. Login ก่อน<br>2. เรียก register ด้วย password ยาว 1 ตัวอักษร | 400 |
| AUTH-12 | Register username ซ้ำ | มี user "admin" | 1. Login ก่อน<br>2. ให้มี user ชื่อ admin อยู่แล้ว<br>3. เรียก register ด้วย username admin | 409 |
| AUTH-13 | Register สำเร็จ | login อยู่ | 1. Login ก่อน<br>2. เรียก register ด้วย username ≥2 ตัว และ password ≥4 ตัว ที่ยังไม่มี | 200 + token + username |
| AUTH-14 | Logout | login อยู่ | 1. Login อยู่<br>2. กดปุ่ม Logout<br>3. สังเกตว่าเด้งกลับหน้า /login | ล้าง token, เด้งไป `/login` |

## 2. API Client / Error Handling (Frontend)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| API-01 | 🟢 แนบ Bearer อัตโนมัติ | มี token | 1. ให้มี token ใน localStorage<br>2. เรียก apiFetch ไป endpoint ที่ต้อง auth<br>3. ดู header ของ request ที่ส่งออก | request มี header `Authorization: Bearer <token>` |
| API-02 | 🟢 ไม่ทับ Authorization ที่ส่งมาเอง | มี token | 1. ให้มี token<br>2. เรียก apiFetch พร้อม header Authorization ที่ส่งมาเอง<br>3. ดู header ที่ส่งออกจริง | ใช้ค่า `Bearer x` ที่ส่งมา |
| API-03 | 🟢 GET เจอ 5xx → retry 1 ครั้ง | mock server คืน 500 | 1. ให้ server ตอบ 500 ครั้งแรก แล้ว 200<br>2. เรียก apiFetch (GET)<br>3. นับจำนวนครั้งที่ fetch ถูกเรียก | ยิงซ้ำ 1 ครั้ง (รวม 2 ครั้ง) |
| API-04 | 🟢 5xx → แสดง banner | – | 1. ทำให้เกิด response 5xx<br>2. สังเกตแบนเนอร์แจ้งเตือนด้านบนจอ | dispatch `api:server-error` → `ApiErrorBanner` ขึ้นข้อความ |
| API-05 | 🟢 401 (protected) → เด้ง login | อยู่หน้า `/dobot` | 1. อยู่หน้า /dobot (มี token)<br>2. เรียก endpoint ที่ตอบ 401<br>3. สังเกตว่าเด้งไป /login | clear token + `location.replace('/login')` |
| API-06 | 🟢 401 จาก `/api/auth/*` ไม่เด้ง | – | 1. เรียก /api/auth/login ที่ตอบ 401<br>2. สังเกตว่าไม่มีการเด้งไป /login | ไม่ redirect |
| API-07 | 🔵 Banner auto-hide | – | 1. ทำให้เกิด 5xx<br>2. รอ 8 วินาที (หรือกดปุ่ม ✕ ปิด) | banner หายเอง (หรือกดปุ่ม ✕ ปิดได้) |

## 3. Dashboard

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| DASH-01 | 🔵 แสดงสถานะเชื่อมต่อ | login แล้ว | 1. Login<br>2. เปิดเมนู Dashboard | แสดงสถานะ robot/camera/ระบบ |
| DASH-02 | 🔵 อัปเดต realtime | ต่อหุ่นจริง | 1. เชื่อมต่อหุ่นจริง<br>2. เปิด Dashboard<br>3. เฝ้าดู 2–3 วินาที | ข้อมูลอัปเดตจาก `/api/map/status` (poll) |
| DASH-03 | 🔵 ระบบออฟไลน์ | ปิดหุ่น/กล้อง | 1. ปิดหุ่น/กล้อง<br>2. เปิด Dashboard<br>3. ดูสถานะว่ารอ/ตัดการเชื่อมต่อ | แสดงสถานะ Disconnected ไม่ค้าง |

## 4. Dobot Controller (`/dobot`)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| DOB-01 | 🔵 Jog Cartesian | ต่อหุ่นแล้ว | 1. เชื่อมต่อหุ่น<br>2. เลือกแกน X และ step = 1<br>3. กดปุ่ม + แล้วกดปุ่ม − | หุ่นขยับทีละ 1mm (`POST /api/map/jog`) |
| DOB-02 | 🔵 Jog Joint | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. เลือกข้อต่อ J1<br>3. กดปุ่ม + / − | ข้อต่อขยับ (`POST /api/map/jog_joint`) |
| DOB-03 | 🔵 เลือก step 0.1/1/5/10 | – | 1. เลือก step = 0.1<br>2. กด jog แล้ววัดระยะที่ขยับ<br>3. ทำซ้ำกับ step 1, 5, 10 | ระยะขยับตรงกับ step |
| DOB-04 | 🔵 Live coordinate | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. ดูแถบพิกัด (X/Y/Z/RX/RY/RZ + J1–J6) แบบสด | แสดง X/Y/Z/RX/RY/RZ + J1–J6 realtime |
| DOB-05 | 🔵 3D Viewer sync | เปิด `/dobot` | 1. เปิดหน้า /dobot<br>2. เทียบท่าทางโมเดล 3D กับพิกัดจริง | ท่าทางโมเดลตรงกับพิกัดจริง |
| DOB-06 | 🔵 IK drag end-effector | เปิด viewer | 1. เปิด 3D viewer<br>2. ลากลูกบอลสีส้มที่ปลายแขน<br>3. สังเกตว่าทุกข้อต่อขยับตาม | ทุกข้อต่อขยับตาม (CCD IK) |
| DOB-07 | 🔵 Home | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. กดปุ่ม Home<br>3. รอหุ่นเคลื่อนไปตำแหน่ง HOME | POST `/api/map/home` → หุ่นไป HOME_* |
| DOB-08 | 🚨 Emergency Stop | ต่อหุ่น | 1. เริ่มให้มีการเคลื่อนที่ (jog/align/draw)<br>2. กดปุ่ม E-Stop<br>3. สังเกตว่าหุ่นหยุดทันที | POST `/api/map/emergency` → หยุดทันที + cancel align/draw |
| DOB-09 | 🔵 Error clear | หุ่น error | 1. ทำให้หุ่นเข้า error state<br>2. กดปุ่ม Clear error | เคลียร์ error (`robot.clear_error`) |
| DOB-10 | 🔵 Connect / Init / CamStart | – | 1. กดปุ่ม Connect<br>2. กดปุ่ม Init<br>3. กดปุ่ม Start Camera | endpoint ทำงาน, สถานะเปลี่ยนเป็น connected |
| DOB-11 | 🔵 CLI command | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. พิมพ์คำสั่งในช่อง CLI<br>3. กดส่ง แล้วดูผลลัพธ์ | POST `/api/map/cli` → ผลลัพธ์แสดงกลับ |

## 5. Camera (`/camera`)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| CAM-01 | 🔵 Live MJPEG | กล้องทำงาน | 1. เปิดหน้า /camera<br>2. ดูภาพสดจากกล้อง | เห็นภาพสด (`GET /api/map/video_feed` / `/api/camera/stream`) |
| CAM-02 | 🔵 Snapshot | กล้องทำงาน | 1. เปิดหน้า /camera<br>2. กดปุ่ม Capture<br>3. ตรวจว่ามีไฟล์ภาพ JPEG | ได้ไฟล์ JPEG (`GET /api/camera/snapshot`) |
| CAM-03 | 🔵 สลับโหมด rgb/gray/depth | กล้องทำงาน | 1. เปิดหน้า /camera<br>2. กดสลับโหมด rgb / gray / depth<br>3. สังเกตภาพเปลี่ยนตามโหมด | ภาพเปลี่ยนโหมด (`POST /api/camera/mode`) |
| CAM-04 | 🔵 Mode toggle | – | 1. กดปุ่ม toggle โหมด<br>2. สังเกตว่าโหมดวนไปตามลำดับ | วนโหมด (`POST /api/camera/mode/toggle`) |
| CAM-05 | 🔵 ตรวจกล้องที่ต่ออยู่ | – | 1. เปิดหน้า /camera<br>2. กด Scan หรือดูรายการกล้อง<br>3. เห็น serial ของกล้องทั้งหมด | `GET /api/camera/devices` แสดง serial ทั้งหมด |
| CAM-06 | 🔵 กล้องตัวที่ 2 (CAM2) | มี D455 2 ตัว | 1. ต่อกล้อง D455 2 ตัว<br>2. เปิด stream ของกล้องตัวที่ 2 | เห็นภาพกล้องที่ 2 (`GET /api/camera/stream2`) |
| CAM-07 | 🔵 Swap view | มี 2 กล้อง | 1. ต่อกล้อง 2 ตัว<br>2. กดปุ่ม Swap View<br>3. ภาพกล้องหลัก/รองสลับกัน | สลับภาพกล้องหลัก/รอง (`POST /api/camera/swap`) |
| CAM-08 | 🔵 เลือกกล้อง primary | มีหลายกล้อง | 1. ต่อกล้องหลายตัว<br>2. เลือกกล้องหลักจากรายการ<br>3. ภาพหลักเปลี่ยนตามที่เลือก | กล้องหลักเปลี่ยนตามที่เลือก |
| CAM-09 | 🔵 Snap กล้อง 2 | มี 2 กล้อง | 1. ต่อกล้อง 2 ตัว<br>2. กด Capture ของกล้องตัวที่ 2 | ได้ภาพจากกล้อง 2 |
| CAM-10 | 🔵 Snapshot แปะ marking | มีจุด mark | 1. mark จุดบนภาพ<br>2. กด Capture<br>3. ตรวจว่าจุดที่ mark ปรากฏในภาพที่บันทึก | ภาพที่ได้มีจุด mark ตรงกับที่เห็น |

## 6. Drawing Mode (`/drawing`)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| DRAW-01 | 🔵 ตั้งขนาด grid | เปิด `/drawing` | 1. เปิดหน้า /drawing<br>2. ไปแท็บ Grid<br>3. ตั้งค่า rows/cols (ไม่เกิน 7×7) | รับค่า rows/cols (≤ 7×7) |
| DRAW-02 | 🔵 Mark จุด grid | jog หุ่นไปจุด | 1. jog หุ่นไปที่จุดมุม<br>2. กดปุ่ม Mark<br>3. ทำซ้ำจนครบทุกจุดใน grid | `POST /api/map/grid/mark` เก็บ pose |
| DRAW-03 | 🔵 Validate grid | mark ครบ | 1. mark จุดให้ครบ<br>2. ดูผลการ validate<br>3. เตือนเมื่อ span เล็กเกินไป หรือ rmse > 3mm | แจ้งเตือนถ้า span เล็กไป หรือ rmse > 3mm |
| DRAW-04 | 🔵 Auto-fill Z | mark แล้ว | 1. mark จุดแล้ว<br>2. กดปุ่ม Autofill Z<br>3. ดูค่า Z ถูกเติมตามพื้นผิว | `POST /api/map/grid/autofill` เติม Z ตามพื้นผิว |
| DRAW-05 | 🔵 Reset grid | มี grid | 1. มี grid ที่สอนไว้<br>2. กดปุ่ม Reset grid | `POST /api/map/grid/reset` ล้าง grid |
| DRAW-06 | 🔵 Restore grid | มี pose ครบ | 1. มี pose ของ grid ครบ<br>2. เรียก /api/map/grid/restore<br>3. grid กลับมาโดยไม่ต้องสอนใหม่ | grid กลับมาตั้งได้โดยไม่ต้องสอนใหม่ |
| DRAW-07 | 🔵 Return-to-start | วาดจบ | 1. วาดจนจบงาน<br>2. สังเกตว่าหัวหุ่นกลับไปจุดเริ่ม | หัวหุ่นกลับไปจุดเริ่ม (ไม่ค้างที่จุดสุดท้าย) |
| DRAW-08 | 🔵 วาดเส้น (pen) | grid ครบ | 1. สอน grid ให้ครบ<br>2. วาดเส้นบน canvas<br>3. กดปุ่ม Send แล้วดูหุ่นวาดตามเส้น | หุ่นวาดตามเส้นบนพื้นผิวจริง (`POST /api/map/draw`) |
| DRAW-09 | 🔵 หยุดกลางการวาด | กำลังวาด | 1. เริ่มวาด (กำลังเคลื่อนที่)<br>2. กดปุ่ม Stop<br>3. หยุดทันที | `POST /api/map/draw/stop` → หยุดทันที |
| DRAW-10 | 🔵 Pen-lift ระหว่างรูป | วาด 2 รูป | 1. วาด 2 รูปคนละตำแหน่ง<br>2. กด Send<br>3. สังเกตการยกหัวก่อนข้ามไปรูปถัดไป | ยกหัวหุ่นก่อนข้ามไปรูปถัดไป |
| DRAW-11 | 🔵 Goto / Point (mark click) | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. กดจุดบนภาพ (โหมด goto/point)<br>3. หุ่นไปยังจุดนั้น | `POST /api/map/goto` หรือ `/point` ทำงานตามโหมด |
| DRAW-12 | 🔵 Frame control | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. เปลี่ยน frame เป็น User/Tool<br>3. สังเกตพิกัดเปลี่ยนตาม frame | `POST /api/map/frame` เปลี่ยน coordinate |

### 6.1 Robot & Teach Panel (tabbed — อัปเดต 2026-09-29)

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| TP-01 | 🔵 สลับแท็บ panel | เปิด `/drawing` | 1. เปิดหน้า /drawing<br>2. กดแท็บ Align, Grid, Jog, All สลับไปมา<br>3. สังเกตว่าเนื้อหา panel เปลี่ยนตามแท็บ | เนื้อหา panel เปลี่ยนตามแท็บที่เลือก (แสดงเฉพาะการ์ดของแท็บนั้น) |
| TP-02 | 🔵 พับ/กาง panel | – | 1. เปิดหน้า /drawing<br>2. กดปุ่ม Fold<br>3. สังเกต panel ย่อ และกดอีกครั้งเพื่อกาง | panel ย่อ/ขยาย (isTeachMinimized) และปุ่มเปลี่ยน label |
| TP-03 | 🔵 Status pills | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. ดู status pills บน panel<br>3. สถานะ/โหมดหุ่นแสดงถูกต้อง | แสดงสถานะเชื่อมต่อ/โหมดหุ่นถูกต้อง |
| TP-04 | 🔵 Quick actions | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. กด Connect, Init, CamStart, Heatmap ทีละปุ่ม<br>3. endpoint ถูกเรียกตามปุ่ม | เรียก endpoint ตรง (connect/init/camstart/heatmap toggle) |
| TP-05 | 🔵 Grid Setup (rows×cols) | – | 1. ไปแท็บ Grid<br>2. เปลี่ยนค่า rows/cols<br>3. ขนาด grid อัปเดต (ไม่เกิน 7×7) | ขนาด grid อัปเดต (`grid/size`) ≤ 7×7 |
| TP-06 | 🔵 Cells Matrix & Shape | mark ครบ | 1. mark grid ครบ<br>2. ดูการ์ด Cells Matrix & Shape<br>3. เห็น preview รูปร่าง grid ตามที่สอน | แสดง preview รูปร่าง grid ตามที่สอน (`grid_shape_2d`) |
| TP-07 | 🔵 Jog ใน panel | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. ไปแท็บ Jog<br>3. กดปุ่ม jog ตามแกน/step | ยิง `POST /api/map/jog` / `jog_joint` ตามแกน/step |
| TP-08 | 🔵 Motion / Step controls | – | 1. ปรับค่า step/speed<br>2. กด jog<br>3. ระยะ/ความเร็วสอดคล้องกับค่าที่ตั้ง | ค่า step/speed ถูกส่งตอน jog |
| TP-09 | 🔵 Corner Alignment (4 points) | mark 4 มุม | 1. mark 4 มุม<br>2. ไปแท็บ Align<br>3. กดปุ่ม Align | `POST /api/map/align` เริ่ม align |
| TP-10 | 🔵 Coordinate Frame (panel) | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. เปลี่ยน coordinate frame ใน panel | `POST /api/map/frame` เปลี่ยน coordinate |
| TP-11 | 🔵 3D viewer มุมล่างซ้าย | เปิด `/drawing` | 1. เปิดหน้า /drawing<br>2. สังเกตตำแหน่ง 3D viewer<br>3. viewer อยู่มุมล่างซ้าย | viewer อยู่มุมล่างซ้ายของหน้า |

## 7. Align / Calibration

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| ALN-01 | 🔵 Start align | mark 4 จุด + กล้อง depth | 1. mark 4 จุด และเปิดกล้อง depth<br>2. กดปุ่ม Start Align<br>3. หุ่นเริ่มหมุนเพื่อปรับระนาบ | `POST /api/map/align` เริ่ม rotate ให้ระนาบตรง |
| ALN-02 | 🔵 Align converge | เริ่มแล้ว | 1. เริ่ม align<br>2. เฝ้าดูค่า tilt ใน status<br>3. หยุดเองเมื่อ tilt ≤ ALIGN_TOL_DEG | tilt ลดลงจน ≤ ALIGN_TOL_DEG แล้วหยุด |
| ALN-03 | 🔵 หยุด align | กำลัง align | 1. ระหว่าง align<br>2. กดปุ่ม Stop | `POST /api/map/align/stop` → หยุด |
| ALN-04 | 🔵 กัน points ไม่ lock | mark ยังไม่ติด | 1. mark จุดที่ tracker ยังไม่ lock<br>2. เริ่ม align<br>3. มีการลองใหม่สั้น ๆ แล้วแจ้ง points not locked | retry สั้น ๆ แล้วแจ้ง "points not locked" |
| ALN-05 | 🔵 Reset points | มีจุด mark | 1. มีจุด mark อยู่<br>2. กดปุ่ม Clear points | `POST /api/map/reset_points` |
| ALN-06 | 🔵 Heatmap toggle | depth ทำงาน | 1. เปิดกล้อง depth<br>2. กดปุ่ม toggle heatmap | `POST /api/map/heatmap/toggle` |

## 8. Move / Sequence

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| MOV-01 | 🔵 Move to pose | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. เรียก move_to ด้วย pose เป้าหมาย<br>3. หุ่นเคลื่อนไปยัง pose นั้น | หุ่นเคลื่อนไป pose ที่ระบุ |
| MOV-02 | 🔵 Move sequence | ตั้งลำดับแล้ว | 1. ตั้งลำดับ waypoint<br>2. เรียก move_sequence<br>3. หุ่นวิ่งตามลำดับ | วิ่งตามลำดับ |
| MOV-03 | 🔵 หยุด sequence | กำลังวิ่ง | 1. เริ่ม move sequence<br>2. กดปุ่มหยุด sequence | หยุดทันที |
| MOV-04 | 🔵 `/api/robot/move` | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. ส่ง {axis, direction, step}<br>3. หุ่นขยับตามที่สั่ง | ขยับตามที่สั่ง |
| MOV-05 | 🚨 `/api/robot/emergency-stop` | ต่อหุ่น | 1. เชื่อมต่อหุ่น<br>2. เรียก /api/robot/emergency-stop | หยุดฉุกเฉิน |

## 9. Settings & Devices

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| SET-01 | 🔵 โหลด settings | login | 1. Login<br>2. เปิดหน้า /settings<br>3. ดูค่าที่โหลดมาแสดง | `GET /api/settings` แสดงค่า |
| SET-02 | 🔵 แก้ settings | – | 1. เปิดหน้า /settings<br>2. แก้ค่า แล้วกดบันทึก<br>3. โหลดใหม่แล้วค่ายังอยู่ | บันทึกค่าใหม่ |
| SET-03 | 🔵 แก้ราย key | – | 1. แก้ค่าเฉพาะ key เดียว<br>2. บันทึก<br>3. key อื่นไม่เปลี่ยน | อัปเดตเฉพาะ key |
| DEV-01 | 🔵 Relay toggle | มี Blynk token | 1. ตั้ง Blynk token<br>2. กดปุ่ม toggle relay | สลับ relay สำเร็จ |
| DEV-02 | 🔵 Relay state | – | 1. เปิดหน้า Devices<br>2. ดูสถานะ relay ปัจจุบัน | คืนสถานะปัจจุบัน |
| DEV-03 | 🔵 Relay history | – | 1. เปิดหน้า Devices<br>2. ดูประวัติการสั่ง relay | คืนประวัติการสั่ง |
| DEV-04 | 🔵 Ping device | – | 1. เปิดหน้า Devices<br>2. กดปุ่ม ping<br>3. แสดงสถานะเข้าถึงได้/ไม่ได้ | คืนสถานะ reachable |

## 10. Security / Middleware

| No | Test Case | Precondition | Steps | Expected Result |
|---|---|---|---|---|
| SEC-01 | 🔵 บังคับ Bearer ทุก `/api/*` | – | 1. ไม่แนบ token<br>2. เรียก /api/map/status<br>3. สังเกตว่าได้ 401 (ยกเว้น /api/auth/*) | 401 (middleware) ยกเว้น `/api/auth/*` |
| SEC-02 | 🔵 CORS ตาม `ALLOWED_ORIGINS` | ตั้ง env | 1. ตั้ง ALLOWED_ORIGINS<br>2. ยิงจาก origin ที่อนุญาต และที่ไม่อนุญาต<br>3. เทียบผล | อนุญาตเฉพาะ origin ในลิสต์ |
| SEC-03 | 🔵 OPTIONS ไม่ถูกบล็อก | – | 1. ส่ง preflight OPTIONS ไป endpoint<br>2. สังเกตว่าไม่ถูกบล็อกด้วย 401 | ผ่าน (ไม่โดน 401) |
| SEC-04 | 🔵 Root health | – | 1. เรียก GET /<br>2. ได้ข้อความ Robot Arm API is running | 200 `{"message":"Robot Arm API is running"}` |

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
