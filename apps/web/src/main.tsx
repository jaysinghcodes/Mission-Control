import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Ticket 12: avatars are the inline robots in components/robots.tsx (sticker
// halo included). The older sprite tokens.css is not loaded — nothing in the
// live UI uses .mc-avatar anymore.
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
