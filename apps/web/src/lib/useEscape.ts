import { useEffect, useRef } from 'react'

/**
 * Esc runs the same close an overlay's Cancel, Close, or backdrop runs.
 * Pass enabled=false while the overlay is closed or busy. Same window
 * keydown listener the profile drawer uses.
 */
export function useEscape(onEscape: () => void, enabled = true): void {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      handler.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
