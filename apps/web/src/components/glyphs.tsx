/**
 * Sidebar nav glyphs — 16×16 stroke icons matching wireframes/gen_wireframes.py
 * `glyph()` (overview, tasks, tickets, backlog, calendar, approvals, agents,
 * office, activity, health, sessions, usage, logs).
 */
export type GlyphKind =
  | 'overview' | 'tasks' | 'tickets' | 'projects' | 'backlog' | 'calendar' | 'approvals'
  | 'agents' | 'office' | 'activity' | 'health' | 'sessions' | 'usage' | 'logs'

export function Glyph({ kind, color = 'currentColor', size = 16 }: { kind: GlyphKind; color?: string; size?: number }) {
  const s = size
  const common = { stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const }
  switch (kind) {
    case 'overview':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <rect x="2" y="2" width="12" height="12" rx="3.5" />
          <line x1="5" y1="8" x2="11" y2="8" />
          <line x1="8" y1="5" x2="8" y2="11" />
        </svg>
      )
    case 'tasks':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          {[4, 8.5, 13].map((y) => (
            <line key={y} x1="2.5" y1={y} x2="13.5" y2={y} strokeWidth={1.8} />
          ))}
          <line x1="2.5" y1="4" x2="5.5" y2="4" strokeWidth={1.8} />
          <line x1="2.5" y1="8.5" x2="5.5" y2="8.5" strokeWidth={1.8} />
          <line x1="2.5" y1="13" x2="5.5" y2="13" strokeWidth={1.8} />
        </svg>
      )
    case 'tickets':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
          <line x1="5" y1="6.5" x2="11" y2="6.5" />
          <line x1="5" y1="10.5" x2="11" y2="10.5" opacity={0.5} strokeWidth={1.4} />
        </svg>
      )
    case 'projects':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <path d="M2 4.2 h3.6 l1.3 1.6 H14 V13 H2 Z" />
        </svg>
      )
    case 'backlog':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <line x1="3" y1="3" x2="13" y2="3" />
          <line x1="3" y1="8" x2="13" y2="8" />
          <line x1="3" y1="13" x2="13" y2="13" />
          <line x1="3" y1="3" x2="3" y2="13" />
        </svg>
      )
    case 'calendar':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <rect x="2.5" y="3" width="11" height="10" rx="3" />
          <line x1="2.5" y1="7.5" x2="13.5" y2="7.5" />
          <line x1="5.5" y1="1.5" x2="5.5" y2="4.5" />
          <line x1="10.5" y1="1.5" x2="10.5" y2="4.5" />
        </svg>
      )
    case 'approvals':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <path d="M2.5 8 l3.5 3.5 l7.5 -8" strokeWidth={1.8} />
        </svg>
      )
    case 'agents':
    case 'office':
      return (
        <svg width={s} height={s} viewBox="0 0 16 20" {...common}>
          <line x1="8" y1="2" x2="8" y2="5.2" strokeWidth={1.2} />
          <circle cx="8" cy="1" r="1.3" fill={color} stroke="none" />
          <rect x="3" y="5.2" width="10" height="7.6" rx="2.6" fill={color} stroke="none" />
          <circle cx="6.1" cy="8.4" r="1.35" fill="#fff" stroke="none" />
          <circle cx="9.9" cy="8.4" r="1.35" fill="#fff" stroke="none" />
          <rect x="5.2" y="14.6" width="5.6" height="5.4" rx="1.9" fill={color} stroke="none" opacity="0.72" />
        </svg>
      )
    case 'activity':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <path d="M1.5 8 L4 8 L6 3 L9 13 L11 8 L14.5 8" strokeWidth={1.7} />
        </svg>
      )
    case 'health':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <path d="M8 2.5 l-6 7 l4 0 l-2 6 l7 -8 l-4 0 z" strokeWidth={1.6} />
        </svg>
      )
    case 'sessions':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          <rect x="2" y="3.5" width="11" height="11" rx="3" />
          <rect x="4.5" y="6" width="11" height="11" rx="3" />
        </svg>
      )
    case 'usage':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          {[5, 8, 11].map((h, i) => (
            <rect key={h} x={2.5 + i * 4.5} y={13 - h} width="3.2" height={h} rx="1" fill={color} stroke="none" />
          ))}
          <line x1="2" y1="14.5" x2="14" y2="14.5" />
        </svg>
      )
    case 'logs':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" {...common}>
          {[4, 7.6, 11.2].map((y) => (
            <line key={y} x1="2.5" y1={y} x2="13.5" y2={y} />
          ))}
          <circle cx="11.5" cy="4" r="1.6" fill={color} stroke="none" />
        </svg>
      )
  }
}
