import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Forward /api calls to the Express backend during development
  server: { proxy: { '/api': 'http://localhost:5000' } },
})
