import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Same origin `/api` forwards to the API. The token is read here, on the
 * server, and attached only to writes. It is not defined into the bundle.
 */
function apiProxy(): ProxyOptions {
  const target = (process.env.VITE_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '')
  return {
    target,
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

const proxy = { '/api': apiProxy() }

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
