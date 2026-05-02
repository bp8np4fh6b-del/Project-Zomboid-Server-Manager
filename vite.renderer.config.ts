import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { join } from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: join(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
  },
})
