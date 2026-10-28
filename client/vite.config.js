/* eslint-env node */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The admin app talks to /api/admin on the same origin. In production the Node
// server serves both; in `npm run dev` this proxy keeps that shape (and the
// Path-scoped owner cookie) working against the server on port 4000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_SERVER_URL || 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
})
