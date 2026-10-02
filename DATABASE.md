# 🗄️ Database Schema — Web Robot

เอกสารโครงสร้างฐานข้อมูลของ **Web Robot** (PostgreSQL 16)

ตารางทั้งหมดถูกสร้างอัตโนมัติจาก SQLAlchemy `Base.metadata.create_all` ตอน backend startup (ดู `backend/main.py` → `lifespan`) โดยนิยามโมเดลอยู่ใน `backend/models.py`

---

## 📊 ER Diagram

```mermaid
erDiagram
    USERS ||--o{ USER_SETTINGS : "has"
    USERS ||--o{ DEVICE_LOGS : "owns"

    USERS {
        string   id            PK "uuid4 (36)"
        string   username      UK "unique, indexed"
        string   password_hash    "bcrypt hash"
        datetime created_at       "UTC"
    }
    USER_SETTINGS {
        string   id         PK "uuid4 (36)"
        string   user_id    FK "-> users.id (CASCADE)"
        string   key           "uq_user_setting (unique per user)"
        text     value         "home_*, cam_serial(2), cam_devices(JSON), sidebar_speed, ..."
        datetime updated_at    "UTC, onupdate"
    }
    DEVICE_LOGS {
        string   id         PK "uuid4 (36)"
        string   user_id    FK "-> users.id (CASCADE)"
        string   device        "robot / align / camera / estop / relay_v1"
        string   state         "event เช่น connect, goto, ok, fail, mode, on/off"
        text     detail        "รายละเอียด (default '')"
        datetime created_at    "UTC"
    }
```

---

## 📋 ตารางรายละเอียด

### `users` — บัญชีผู้ใช้

| คอลัมน์ | ชนิด | Constraint | คำอธิบาย |
|---|---|---|---|
| `id` | `String(36)` | **PK** | UUID v4 (สร้างอัตโนมัติ) |
| `username` | `String(64)` | **UNIQUE**, NOT NULL, INDEX | ชื่อผู้ใช้ |
| `password_hash` | `String(128)` | NOT NULL | bcrypt hash (ไม่เก็บ plaintext) |
| `created_at` | `DateTime(tz)` | default = UTC now | เวลาสร้าง |

### `user_settings` — settings รายผู้ใช้ (key/value)

| คอลัมน์ | ชนิด | Constraint | คำอธิบาย |
|---|---|---|---|
| `id` | `String(36)` | **PK** | UUID v4 |
| `user_id` | `String(36)` | **FK** → `users.id` `ON DELETE CASCADE`, INDEX | เจ้าของ setting |
| `key` | `String(128)` | NOT NULL | ชื่อ setting |
| `value` | `Text` | NOT NULL, default `''` | ค่า setting |
| `updated_at` | `DateTime(tz)` | default/onupdate = UTC now | เวลาแก้ล่าสุด |

> `UNIQUE(user_id, key)` (`uq_user_setting`) — ผู้ใช้ 1 คนมี setting ต่อ key ได้ค่าเดียว

คีย์ที่แอปใช้จริง (ค่าเริ่มต้นอยู่ใน `backend/routers/settings.py` → `DEFAULTS`):

| key | ใช้กับ |
|---|---|
| `home_x`, `home_y`, `home_z`, `home_rx`, `home_ry`, `home_rz` | พิกัด home ต่อผู้ใช้ — ปุ่ม Home ใช้ค่านี้ ถ้าไม่ตั้ง/เป็น 0 จะ fallback ไป `HOME_*` ใน `.maps_point.env` |
| `cam_serial`, `cam_serial2` | serial กล้องหลัก/รอง ที่ผู้ใช้เลือก (จากหน้า Settings) |
| `cam_devices` | JSON list ของกล้องที่สแกนเจอ (cache จากการ Scan) |
| `sidebar_speed` | ความเร็ว jog บน Sidebar (%) |
| `robot_ip`, `move_speed`, `depth_roi`, `min_depth_mm`, `theme` | ค่า default อื่น ๆ (ยังไม่ผูก UI ครบ) |

### `device_logs` — ประวัติเหตุการณ์ (robot / align / camera / estop / relay)

| คอลัมน์ | ชนิด | Constraint | คำอธิบาย |
|---|---|---|---|
| `id` | `String(36)` | **PK** | UUID v4 |
| `user_id` | `String(36)` | **FK** → `users.id` `ON DELETE CASCADE`, INDEX | ผู้สั่ง |
| `device` | `String(64)` | NOT NULL | ประเภทเหตุการณ์ (`robot` / `align` / `camera` / `estop` / `relay_v1`) |
| `state` | `String(16)` | NOT NULL | เหตุการณ์ เช่น `connect`, `init`, `home`, `goto`, `mode`, `ok`, `fail`, `on`/`off` |
| `detail` | `Text` | NOT NULL, default `''` | รายละเอียดเพิ่มเติม (เช่น `cam1=depth`, `x=423 y=281`, `poor fit …`) |
| `created_at` | `DateTime(tz)` | default = UTC now | เวลาที่เกิดเหตุการณ์ |

> `device_logs` โตเร็ว เพราะ align/auto-align เขียนเป็นลูป → มี `POST /api/devices/events/prune` ตัดให้เหลือ N แถวล่าสุดต่ออุปกรณ์

---

## 🔗 ความสัมพันธ์

| ความสัมพันธ์ | ชนิด | Cascade |
|---|---|---|
| `users` → `user_settings` | 1 : N | `cascade="all, delete-orphan"` + `ondelete="CASCADE"` |
| `users` → `device_logs` | 1 : N | `ondelete="CASCADE"` |

ลบ user 1 คน → ลบ `user_settings` และ `device_logs` ที่เกี่ยวข้องทั้งหมด

---

## 🗺️ ตาราง ↔ API

| ตาราง | ถูกใช้โดย |
|---|---|
| `users` | `/api/auth/register`, `/api/auth/login`, `/api/auth/me` |
| `user_settings` | `/api/settings` (GET/PUT) — Sidebar speed, หน้า Settings (home position, เลือกกล้อง, cache รายการกล้อง) |
| `device_logs` | `/api/devices/relay/*`, `/api/devices/events`, `/api/devices/events/prune` — เขียนผ่าน `device_events.log_event()` และ `mapcontrol._log_user_event()` |

---

## 🧱 Migration / Schema notes

- ตารางสร้างจาก `Base.metadata.create_all` ตอน startup — **สร้างเฉพาะตารางที่ยังไม่มี ไม่เพิ่มคอลัมน์ให้ตารางเดิม**
- คอลัมน์ `device_logs.detail` ถูกเพิ่มบน DB ที่รันอยู่ด้วย `ALTER TABLE` (DB ที่สร้างใหม่ได้คอลัมน์นี้จาก model อยู่แล้ว)
- `camera_selection.json` (ที่ `backend/`) เก็บกล้องหลัก/รองที่เลือกไว้ให้ backend เปิดเองตอน boot — เป็น state ของฮาร์ดแวร์ **ไม่ใช่ per-user** จึงอยู่นอก DB

---

## ⚙️ การเชื่อมต่อ

- DSN: env `DATABASE_URL` (ค่า default `postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings`)
- โค้ดแปลง `postgresql://` / `postgres://` → `postgresql+asyncpg://` ให้อัตโนมัติ (ดู `backend/database.py`)
- Engine เป็น async (`create_async_engine`) + `pool_pre_ping`, `pool_recycle=1800`
- Session ผ่าน dependency `get_db()` (auto-close)
