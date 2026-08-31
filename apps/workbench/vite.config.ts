import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY || 'http://localhost:3011',
        changeOrigin: true,
      },
    },
    port: 3015,
  },
})