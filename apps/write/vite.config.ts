import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 生产部署在 /dev/write/ 子路径（§3.2）；开发期同路径，行为一致
export default defineConfig({
  plugins: [react()],
  base: '/dev/write/',
  server: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY || 'http://localhost:3011',
        changeOrigin: true,
      },
    },
  },
})
