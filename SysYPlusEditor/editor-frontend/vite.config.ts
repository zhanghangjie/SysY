import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../sys/media', // sys 是你的插件目录
    emptyOutDir: false,
  },
})
