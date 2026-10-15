# 📷 Camera & Streaming — Web Robot

สรุปการทำงานของ **กล้อง (Intel RealSense D455 ×2)**, การเชื่อมต่อ, และ **MJPEG stream**
อ้างจากโค้ดจริง (`backend/maps_point/camera.py`, `backend/routers/camera.py`, `backend/routers/mapcontrol.py`, `backend/main.py`)

---

## 🧩 ภาพรวม
```
D455 ──USB──► pyrealsense2 (pipeline)            [maps_point/camera.py]
        │  depth(z16) + color(bgr8) + accel
        ▼
   shared buffers (_depth_buf / _color_buf)      ← capture thread เขียน
        │
        ├─► align / tracking อ่าน buffer         [align.py]
        └─► MJPEG generator อ่าน buffer          [mapcontrol.py]
                 │  cv2.imencode(JPEG)  (แชร์ 1 encode ต่อเฟรม)
                 ▼
            HTTP multipart MJPEG                  [GET /api/map/video_feed]
                 ▼
              nginx (proxy_buffering off) ──► browser <img>
```
> **pyrealsense2 ไม่ได้ stream เอง** — มันดึงเฟรมจาก USB มาเป็น numpy array ในเครื่อง; ส่วน "stream" ที่เห็นบนเว็บคือ **HTTP MJPEG** ที่ backend สร้างขึ้น (encode JPEG ต่อเฟรม)

---

## 1) 📸 การจัดการกล้อง (2 ตัว)
| กล้อง | ตัวแปร | หมายเหตุ |
|---|---|---|
| CAM1 (primary) | `cam` (singleton ใน `mapcontrol.py`) | ใช้ `CAM_SERIAL`; มี tracking/align/cloud |
| CAM2 (secondary) | `cam2` (lazy singleton, `routers/camera.py:40`) | start เมื่อเริ่มใช้ (`start_cam2_once`); มี `_cam2_start_lock` กัน race |

**Endpoints** (`/api/camera`):
| endpoint | ทำอะไร |
|---|---|
| `GET /devices` | list กล้องที่ cache + selected + secondary |
| `POST /scan` | enumerate D455 (`list_devices()`) โดย**ไม่แตะ pipeline** (timeout 6s) |
| `POST /select {serial}` | สลับ primary: `cam.stop()` → `set_serial` → `start()`; ย้ายตัวเก่าไป cam2 |
| `POST /swap` | สลับ primary ↔ secondary |
| `GET/POST /mode`, `/mode2`, `/mode/toggle` | rgb / gray / depth |
| `GET /snapshot`, `/snapshot2` | JPEG เฟรมเดียว |

**Persist**: `backend/camera_selection.json` = `{"primary": ..., "secondary": ...}` — เก็บ state ฮาร์ดแวร์ (**ไม่ใช่ per-user**, อยู่นอก DB) โหลดตอน boot เพื่อ resume
**Inter-cam sync**: `set_inter_cam_sync` (D455 HW sync master/slave) ผ่าน env `CAM_INTER_SYNC` / `CAM2_INTER_SYNC`

---

## 2) 🔌 การเชื่อมต่อ
**กล้อง (AutoStart thread — `main.py`)**:
1. enumerate devices → `load_saved_selection()` → ตั้ง serial ให้ cam
2. `set_inter_cam_sync(CAM_INTER_SYNC)` → `cam.start()` (retry 3 ครั้ง)
3. start cam2

**`Camera.start()` → `_start_locked`**: สร้าง `rs.pipeline` + `rs.config` (depth+color, +accel ถ้ามี) → `pipe.start()` → อ่าน intrinsics → init point-cloud pipeline → เปิด **capture thread**

**ความเสถียร (web เพิ่ม)**:
- `_START_LOCK` — serialize การ bring-up 2 กล้อง (กันแย่ง USB)
- `_hardware_reset()` — power-cycle USB เมื่อ depth stream ค้าง ("Frame didn't arrive")
- `_reopen_pipeline()` — capture thread recover เองเมื่อ USB หลุด (`RECONNECT_AFTER` timeouts)

**หุ่น**: `_connect_robot` thread → `Robot.connect()` (dashboard 29999 + move 30003) → `init_robot()` (ClearError/Reset/PowerOn/Enable/SpeedFactor)

---

## 3) 📡 MJPEG stream
**CAM1**: `GET /api/map/video_feed` (alias `/api/camera/stream`)
```python
StreamingResponse(_mjpeg_generator(mode),
    media_type="multipart/x-mixed-replace; boundary=frame",
    headers=_STREAM_HEADERS)   # X-Accel-Buffering:no + no-cache
```
- `_mjpeg_generator` (`mapcontrol.py:424`): อ่าน **shared buffer** (`cam.get_latest_frames_ref()`) → **ไม่แตะ hardware** → viewer หลายตัวได้; รอเฟรมใหม่ (เทียบ `cam._frame_count`) → pace `STREAM_TARGET_FPS=15`
- `_encode_frame` (`:382`): **encode ครั้งเดียวต่อ (frame_count, mode, heatmap)** แล้ว cache `_ENC_CACHE` → N viewers = 1 encode; ทำ mode (depth colorize / gray) → `draw_overlay` → resize `848×480` → JPEG Q65

**CAM2**: `GET /api/camera/stream2` → `_mjpeg_generator_cam2` (generator แยก, lazy-start cam2, Q70 @ 8fps)

**ค่าคงที่สตรีม** (`mapcontrol.py:346`): `STREAM_W=848`, `STREAM_H=480`, `STREAM_JPEG_QUALITY=65`, `STREAM_TARGET_FPS=15`

**nginx** (`frontend/nginx.conf`): `location ~ ^/api/(map/video_feed|camera/stream)` → proxy + `proxy_buffering off` + `X-Accel-Buffering no` (MJPEG ห้าม buffer)

---

## 4) 🧰 ไลบรารีที่ใช้
| ไลบรารี | ใช้ทำอะไร |
|---|---|
| **`pyrealsense2`** (`import pyrealsense2 as rs`, มี `HAS_RS` fallback) | enumerate D455, pipeline (depth/color/accel), `align.process`, SDK point cloud |
| **`opencv-python-headless` (cv2)** | region-grow (`connectedComponentsWithStats`, `minAreaRect`, `boxPoints`), `approxPolyDP` (Douglas-Peucker ใน planegrid), `imencode` JPEG, `resize`, `applyColorMap`, `cvtColor`, `draw_overlay`/`putText` |

> `backend/requirements.txt`: `opencv-python-headless`, `pyrealsense2`
> `requirements-dev.txt` **ไม่ใส่ pyrealsense2** (hardware-only) เพื่อรัน unit test ได้โดยไม่มีกล้อง

---

## 🗂️ ไฟล์ที่เกี่ยวข้อง
| ไฟล์ | บทบาท |
|---|---|
| `backend/maps_point/camera.py` | คลาส `Camera` (pipeline, capture thread, sample_depth, region-grow) |
| `backend/routers/camera.py` | API กล้อง (scan/select/swap/mode/stream2/snapshot) |
| `backend/routers/mapcontrol.py` | CAM1 singleton, `_mjpeg_generator`, `_encode_frame`, `/video_feed` |
| `backend/main.py` | AutoStart กล้อง/หุ่น, `/ws/joints` |
| `frontend/nginx.conf` | proxy MJPEG (no-buffer) |
