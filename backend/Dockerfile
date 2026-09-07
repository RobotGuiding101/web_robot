# =============================================
# Backend Dockerfile — FastAPI (Python)
# =============================================
FROM python:3.12-slim

WORKDIR /app

# ติดตั้ง native dependencies สำหรับ pyrealsense2 + opencv
RUN apt-get update && apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ติดตั้ง Python dependencies ก่อน (cache layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# คัดลอก source code
COPY . .

# expose port
EXPOSE 8000

# รัน production (ไม่ใช้ --reload)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
