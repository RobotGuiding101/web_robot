# =============================================
# Frontend Dockerfile — React + Vite (multi-stage)
# =============================================

# ── Stage 1: Build ──────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# ติดตั้ง dependencies ก่อน (cache layer)
COPY package*.json ./
RUN npm ci

# คัดลอก source แล้ว build
COPY . .
RUN npm run build

# ── Stage 2: Serve ──────────────────────────
FROM nginx:alpine AS runner

# ลบ default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# ใส่ nginx config ที่ support React Router (SPA fallback)
COPY nginx.conf /etc/nginx/conf.d/app.conf

# คัดลอก static files จาก build stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
