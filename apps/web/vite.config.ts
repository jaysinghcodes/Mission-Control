import { fileURLToPath } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Same origin `/api` forwards to the API. The browser sends the session
 * cookie. This proxy does not attach a write token or a socket token.
 */
function apiTarget(): string {
  return (process.env.VITE_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '')
}

function apiProxy(): ProxyOptions {
  return {
    target: apiTarget(),
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '') || '/',
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
    fs: { allow: [webRoot, repoRoot] },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    proxy,
  },
})
