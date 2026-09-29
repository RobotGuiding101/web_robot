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
        string   key           "unique per user"
        text     value         "default ''"
        datetime updated_at    "UTC, onupdate"
    }
    DEVICE_LOGS {
        string   id         PK "uuid4 (36)"
        string   user_id    FK "-> users.id (CASCADE)"
        string   device        "เช่น relay_v1"
        string   state         "on / off"
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

### `device_logs` — ประวัติการสั่งงานอุปกรณ์

| คอลัมน์ | ชนิด | Constraint | คำอธิบาย |
|---|---|---|---|
| `id` | `String(36)` | **PK** | UUID v4 |
| `user_id` | `String(36)` | **FK** → `users.id` `ON DELETE CASCADE`, INDEX | ผู้สั่ง |
| `device` | `String(64)` | NOT NULL | ชื่ออุปกรณ์ (เช่น `relay_v1`) |
| `state` | `String(16)` | NOT NULL | สถานะ (`on` / `off`) |
| `created_at` | `DateTime(tz)` | default = UTC now | เวลาที่สั่ง |

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
| `user_settings` | `/api/settings` (GET / PUT), Sidebar speed, หน้า Settings |
| `device_logs` | `/api/devices/relay/toggle`, `/api/devices/relay/state`, `/api/devices/relay/history` |

---

## ⚙️ การเชื่อมต่อ

- DSN: env `DATABASE_URL` (ค่า default `postgresql+asyncpg://robot:robot123@localhost:5432/robot_settings`)
- โค้ดแปลง `postgresql://` / `postgres://` → `postgresql+asyncpg://` ให้อัตโนมัติ (ดู `backend/database.py`)
- Engine เป็น async (`create_async_engine`) + `pool_pre_ping`, `pool_recycle=1800`
- Session ผ่าน dependency `get_db()` (auto-close)
