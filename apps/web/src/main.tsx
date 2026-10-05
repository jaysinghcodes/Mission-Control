import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Ticket 12: avatars are the inline robots in components/robots.tsx (sticker
// halo included). The old sprite sheet is not part of the live UI.
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
