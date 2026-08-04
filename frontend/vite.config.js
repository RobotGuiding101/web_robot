import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // ทำให้ VITE_ env ที่ส่งมาผ่าน docker build args ใช้งานได้
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
})
