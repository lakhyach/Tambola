/* eslint-env node */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { DEFAULT_BRAND, normalizeManifestAccent } from './src/brand-defaults.js'

export function manualVendorChunk(id) {
  const normalizedId = id.replaceAll('\\', '/')
  if (normalizedId.endsWith('/node_modules/three/build/three.core.js')) return 'three-core'
  return undefined
}

const htmlAttribute = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])

function brandMetadata(env) {
  const configuredName = env.VITE_APP_NAME?.trim() || DEFAULT_BRAND.name
  const name = configuredName.toLowerCase() === 'tambola house' ? DEFAULT_BRAND.name : configuredName
  const subtitle = env.VITE_APP_SUBTITLE?.trim() || DEFAULT_BRAND.subtitle
  const iconPath = env.VITE_APP_ICON?.trim() || `/brand/${DEFAULT_BRAND.icon}`
  const icon = iconPath.startsWith('/brand/') ? iconPath.slice('/brand/'.length) : ''
  const accent = normalizeManifestAccent(env.VITE_BRAND_COLOR)
  const manifestQuery = new URLSearchParams({ fallbackName: name, fallbackSubtitle: subtitle, fallbackIcon: icon, fallbackAccent: accent })
  const manifestHref = htmlAttribute(`/api/public/manifest.webmanifest?${manifestQuery.toString()}`)
  const escapedName = htmlAttribute(name)
  const escapedSubtitle = htmlAttribute(subtitle)
  return {
    name: 'configured-brand-metadata',
    transformIndexHtml(html) {
      return html.replaceAll('__APP_NAME__', escapedName).replaceAll('__APP_SUBTITLE__', escapedSubtitle).replaceAll('__MANIFEST_HREF__', manifestHref)
    },
  }
}

// The admin app talks to /api/admin on the same origin. In production the Node
// server serves both; in `npm run dev` this proxy keeps that shape (and the
// Path-scoped owner cookie) working against the server on port 4000.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), brandMetadata(env)],
    build: {
      rollupOptions: {
        output: {
          manualChunks: manualVendorChunk,
        },
      },
    },
    server: {
      proxy: {
        // Socket.IO lives on the same backend as /api. In `npm run dev` the page
        // is served by Vite on 5173 while the game server listens on 4000, so
        // without this the client's io(window.location.origin) handshake hits
        // Vite's SPA fallback (index.html) instead of engine.io and every screen
        // stays stuck on "Reconnecting…". Proxying keeps the browser same-origin
        // (5173 -> 5173), which satisfies the server's same-origin CORS policy.
        // `ws: true` forwards the WebSocket upgrade; polling falls back to /api's
        // sibling path automatically.
        '/socket.io': {
          target: env.VITE_SERVER_URL || process.env.VITE_SERVER_URL || 'http://localhost:4000',
          ws: true,
          changeOrigin: false,
        },
        '/api': {
          target: env.VITE_SERVER_URL || process.env.VITE_SERVER_URL || 'http://localhost:4000',
          changeOrigin: false,
          configure(proxy) {
            proxy.on('error', (_error, request, response) => {
              if (!response || response.headersSent || !request.url?.startsWith('/api/moderator')) return
              response.writeHead(503, {
                'Cache-Control': 'no-store',
                'Content-Type': 'application/json; charset=utf-8',
              })
              response.end(JSON.stringify({
                ok: false,
                code: 'UPSTREAM_UNAVAILABLE',
                error: 'Moderator service is unavailable. Start the local API server and try again.',
              }))
            })
          },
        },
      },
    },
  }
})
