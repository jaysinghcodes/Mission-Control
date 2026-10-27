import { fileURLToPath } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function readPort(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback
  const port = Number(raw.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback
  return port
}

/** Browser port. MC_WEB_PORT, then 5173. */
function webPort(): number {
  return readPort(process.env.MC_WEB_PORT, 5173)
}

/**
 * Native API port. PORT wins. MC_API_PORT is accepted when PORT is unset.
 * Same rule as the API process and doctor.
 */
function apiPort(): number {
  if (typeof process.env.PORT === 'string' && process.env.PORT.trim() !== '') {
    return readPort(process.env.PORT, 3000)
  }
  return readPort(process.env.MC_API_PORT, 3000)
}

/**
 * Same origin `/api` forwards to the API. The browser sends the session
 * cookie. This proxy does not attach a write token or a socket token.
 */
function apiTarget(): string {
  return (process.env.VITE_API_URL || `http://127.0.0.1:${apiPort()}`).replace(/\/+$/, '')
}

function apiProxy(): ProxyOptions {
  return {
    target: apiTarget(),
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '') || '/',
  }
}

const proxy = {
  '/api': apiProxy(),
  '/socket.io': {
    target: apiTarget(),
    changeOrigin: true,
    ws: true,
  },
}

const listenPort = webPort()

// https://vite.dev/config/
export default defineConfig({
  define: {
    __MC_WEB_PORT__: JSON.stringify(String(listenPort)),
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: listenPort,
    strictPort: true,
    proxy,
    fs: { allow: [webRoot, repoRoot] },
  },
  preview: {
    host: '127.0.0.1',
    port: listenPort,
    strictPort: true,
    proxy,
  },
})
