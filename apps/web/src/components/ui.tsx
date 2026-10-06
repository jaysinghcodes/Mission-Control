import type { ReactNode } from 'react'

/**
 * Shared UI primitives — translated 1:1 from wireframes/gen_wireframes.py:
 * card() rx=12, chip() pills, pill_btn() buttons, progress(), bot(), search_field().
 * Spacing rule from the flow doc: ≥16px inside cards, ≥24px between blocks.
 */

/** Rounded card container (wireframe `card()`: rx=12, 1px border). */
export function Card({ children, className = '', rx = 'rounded-xl' }: { children: ReactNode; className?: string; rx?: string }) {
  return (
    <div className={`border border-mc-border bg-mc-card ${rx} ${className}`}>{children}</div>
  )
}

/** Inner panel (wireframe `inner`: nested card surfaces). */
export function Inner({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-mc-inner ${className}`}>{children}</div>
}

/** Uppercase section label (11px, letter-spaced, faint). */
export function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-[0.1em] text-mc-faint ${className}`}>
      {children}
    </div>
  )
}

/** Pill chip (wireframe `chip()`: h≈20, 10.5px semibold). */
export function Chip({ label, bg, fg, h = 20, fs = 'text-[10.5px]', className = '' }: { label: string; bg: string; fg: string; h?: number; fs?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap ${fs} ${className}`}
      style={{ height: h, backgroundColor: bg, color: fg }}
    >
      <span className="px-2.5">{label}</span>
    </span>
  )
}

/** Pill button (wireframe `pill_btn()`: rounded-full; on = filled primary). */
export function PillButton({
  label, on = false, className = '', style, onClick,
}: { label: string; on?: boolean; className?: string; style?: React.CSSProperties; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full px-4 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150 ${
        on ? 'bg-mc-accent-fill text-white' : 'border border-mc-border bg-mc-card text-mc-sub hover:text-mc-text'
      } ${className}`}
      style={style}
    >
      {label}
    </button>
  )
}

/** Progress bar (wireframe `progress()`: 5-6px track + colored fill). */
export function Progress({ pct, color, w = 'w-full', h = 5, className = '' }: { pct: number; color: string; w?: string; h?: number; className?: string }) {
  return (
    <div className={`${w} rounded-full bg-mc-track overflow-hidden ${className}`} style={{ height: h }}>
      <div className="rounded-full" style={{ width: `${Math.min(pct, 100)}%`, height: h, backgroundColor: color }} />
    </div>
  )
}

/** Search field (wireframe `search_field()`: pill, magnifier, placeholder). */
export function SearchField({ placeholder = 'Search', w = 200, h = 32, value, onChange }: { placeholder?: string; w?: number; h?: number; value?: string; onChange?: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-mc-border bg-mc-inner px-3" style={{ width: w, height: h }}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="4.5" stroke="var(--mc-faint)" strokeWidth="1.5" />
        <line x1="10.4" y1="10.4" x2="14" y2="14" stroke="var(--mc-faint)" strokeWidth="1.5" />
      </svg>
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full bg-transparent text-[12.5px] text-mc-text placeholder:text-mc-faint outline-none"
      />
    </div>
  )
}

/** Status dot. */
export function Dot({ color, size = 5 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, backgroundColor: color }} />
}

/** KPI tile (wireframe Overview stats: 188×74 card, 40px value, 11px label). */
export function KpiCard({ value, label, valueClass = 'text-mc-text' }: { value: string; label: string; valueClass?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className={`text-[40px] font-semibold leading-none ${valueClass}`}>{value}</div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-mc-faint">{label}</div>
    </Card>
  )
}

/** Robot glyph (wireframe `bot()`: antenna, head, eyes, body — color = agent). */
export function Bot({ color, scale = 1 }: { color: string; scale?: number }) {
  return (
    <svg width={16 * scale} height={20 * scale} viewBox="0 0 16 20" fill="none" className="shrink-0">
      <line x1="8" y1="0" x2="8" y2="3.2" stroke={color} strokeWidth="1.2" />
      <circle cx="8" cy="1" r="1.3" fill={color} />
      <rect x="3" y="3.2" width="10" height="7.6" rx="2.6" fill={color} />
      <circle cx="6.1" cy="6.4" r="1.35" fill="#FFFFFF" />
      <circle cx="9.9" cy="6.4" r="1.35" fill="#FFFFFF" />
      <rect x="5.2" y="12.6" width="5.6" height="6.6" rx="1.9" fill={color} opacity="0.72" />
    </svg>
  )
}
