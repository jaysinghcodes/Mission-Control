import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Same origin `/api` forwards to the API. The token is read here, on the
 * server, and attached only to writes. It is not defined into the bundle.
 */
function apiTarget(): string {
  return (process.env.VITE_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '')
}

function apiProxy(): ProxyOptions {
  return {
    target: apiTarget(),
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '') || '/',
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        const method = (req.method || '').toUpperCase()
        if (!WRITE_METHODS.has(method)) return
        const token = process.env.INGEST_TOKEN
        if (typeof token !== 'string' || token.trim() === '') return
        proxyReq.setHeader('x-ingest-token', token)
      })
    },
  }
}

// Same origin. /api is REST (the prefix is stripped). /socket.io is the live
// feed. The browser does not need VITE_API_URL for `npm run dev`.
const proxy = {
  '/api': apiProxy(),
  '/socket.io': {
    target: apiTarget(),
    changeOrigin: true,
    ws: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    proxy,
  },
})
