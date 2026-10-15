# 🗄️ Archive — ไฟล์รุ่นเก่า / ถูกแทนที่แล้ว

โฟลเดอร์นี้เก็บไฟล์ที่ **ถูกแทนที่แล้ว** เพื่อให้รากโปรเจคเหลือเฉพาะของที่ใช้งานจริง
ทุกไฟล์ยังอยู่ใน git history เดิม ถ้าต้องการคืน ใช้ `git log --follow -- <path>` ได้

---

## `test-cases-v102/` — ชุดทดสอบรุ่นแรก (102 เคส)

| ไฟล์ | สถานะ | ถูกแทนที่โดย |
|---|---|---|
| `TEST_CASES.csv` | เคส 102 รายการ (10 คอลัมน์, ยังไม่มีผล) | `evidence/test_cases_verified.csv` (150 เคส + ผลจริง) |
| `TEST_CASES.xlsx` | ส่งออกจาก CSV ข้างบน (102 แถว) | `TEST_CASES_new.xlsx` (150 แถว) |
| `TEST_CASES_SUMMARY.csv` | สรุป 17 โมดูล แต่คอลัมน์ Pass/Fail **ว่างทั้งหมด** | ผลจริงอยู่ใน `evidence/test_cases_verified.csv` |

> เอกสารสเปกฉบับอ่านสะดวกของชุด 102 เคสยังอยู่ที่รากคือ **`TEST_CASES.md`**
> ชุดที่ใช้งานจริงปัจจุบันคือ **150 เคส** = 102 เคสเดิม + 48 เคสใหม่
> (Align/BE-*, CAM-11/12, Scan, Activity Log, Public Access, Automated Unit Tests)

---

## `models/Link6s.dae` — โมเดล link6 ที่ไม่ถูกใช้งาน

| เรื่อง | รายละเอียด |
|---|---|
| ขนาด | ~3.6 MB |
| ที่มา | commit `313185a` — “rename Link6 model to Link6s.dae and force pure red link6” |
| สถานะ | **ไม่มีโค้ดไหนโหลดไฟล์นี้** — `viewer-boot.js:425` โหลด `models/Link6_S.dae` แทน |
| เหตุผลที่แทนที่ | commit `ccba867` “model link6 new” เพิ่ม `Link6_S.dae` เข้ามา (โมเดลใหม่กว่า) และ viewer ใช้ตัวนั้น |

> การย้อม link6 สีแดง + logic วาง gizmo ที่ปลายจริง **ยังอยู่** ในโค้ด —
> อยู่ใน block ที่โหลด `Link6_S.dae` (`frontend/public/viewer-boot.js:425-438`)
> ดังนั้นการลบไฟล์นี้ **ไม่กระทบภาพใน viewer**

---

## วิธีคืนไฟล์

```bash
# ดูประวัติของไฟล์ที่ถูกย้าย
git log --follow -- archive/test-cases-v102/TEST_CASES.csv

# คืนกลับจาก commit ก่อนหน้าที่ย้าย
git checkout <commit-sha>^ -- TEST_CASES.csv
git checkout <commit-sha>^ -- frontend/public/models/Link6s.dae
```