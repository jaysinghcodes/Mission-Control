import type { ReactNode } from 'react'
import { AgentAvatar, type AvatarAgentShape } from './AgentAvatar'
import { useNaming } from '../lib/naming'

/** Soft white card — the mock's rounded shadow card. */
export function SoftCard({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'button' | 'article'
}) {
  return <Tag className={`mc-card ${className}`}>{children}</Tag>
}

export function Kicker({ children, tone = 'sub' }: { children: ReactNode; tone?: 'sub' | 'red' | 'accent' }) {
  const color = tone === 'red' ? 'text-mc-redtext' : tone === 'accent' ? 'text-mc-accent-text' : 'text-mc-sub'
  return (
    <div className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] ${color}`}>{children}</div>
  )
}

/** Tinted status chip. Red is reserved for "needs you". */
export function StatusChip({
  label,
  tone,
  className = '',
}: {
  label: string
  tone: 'blue' | 'orange' | 'green' | 'teal' | 'red' | 'gray'
  className?: string
}) {
  const map = {
    blue: 'bg-mc-bluebg text-mc-bluetext',
    orange: 'bg-mc-orangebg text-mc-orangetext',
    green: 'bg-mc-greenbg text-mc-greentext',
    teal: 'bg-mc-tealbg text-mc-tealtext',
    red: 'bg-mc-redbg text-mc-redtext',
    gray: 'bg-mc-fill text-mc-graytext',
  } as const
  return (
    <span className={`inline-flex h-[22px] items-center rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap ${map[tone]} ${className}`}>
      {label}
    </span>
  )
}

export function Btn({
  children,
  kind = 'plain',
  onClick,
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  kind?: 'primary' | 'plain' | 'ghost' | 'outline'
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const look = {
    primary: 'bg-mc-accent-fill text-white',
    plain: 'bg-mc-ctl text-mc-text',
    ghost: 'bg-transparent text-mc-accent-text',
    outline: 'bg-mc-card text-mc-text border border-mc-border',
  }[kind]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3.5 text-[13px] font-semibold whitespace-nowrap disabled:opacity-50 ${look} ${className}`}
    >
      {children}
    </button>
  )
}

export function Segmented({
  labels,
  active,
  onChange,
  ariaLabel,
  fit = false,
}: {
  labels: string[]
  active: number
  onChange: (index: number) => void
  ariaLabel: string
  /** Below sm, stretch to the row and let each tab shrink to its label so the set never runs past its card. */
  fit?: boolean
}) {
  const track = fit ? 'flex w-full min-w-0 sm:inline-flex sm:w-auto' : 'inline-flex shrink-0'
  const size = fit ? 'min-w-0 flex-auto px-2 sm:flex-none sm:min-w-[84px] sm:px-3' : 'min-w-[84px] px-3'
  return (
    <div role="tablist" aria-label={ariaLabel} className={`${track} h-8 items-center rounded-[9px] bg-mc-ctl p-[3px]`}>
      {labels.map((label, i) => {
        const on = i === active
        return (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(i)}
            className={`h-[26px] ${size} rounded-[7px] text-[13px] whitespace-nowrap ${
              on ? 'bg-mc-thumb font-semibold text-mc-text shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'font-medium text-mc-sub2'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label: string
}) {
  return (
    <label className="flex h-8 w-[180px] shrink-0 items-center gap-2 rounded-[9px] bg-mc-ctl px-3">
      <span className="sr-only">{label}</span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="4.2" stroke="var(--mc-sub)" strokeWidth="1.6" />
        <path d="M10.2 10.2 L13 13" stroke="var(--mc-sub)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full bg-transparent text-[13px] text-mc-text outline-none placeholder:text-mc-placeholder"
      />
    </label>
  )
}

/** Page title row. The connection chip lives in the sidebar so this row can wrap tools without splitting "Connected · 9ms". */
export function PageHeader({
  title,
  summary,
  tools,
}: {
  title: string
  summary: string
  tools?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-mc-text">{title}</h1>
        <p className="mt-0.5 text-[13px] text-mc-sub">{summary}</p>
      </div>
      {tools && <div className="flex flex-wrap items-center justify-end gap-2">{tools}</div>}
    </div>
  )
}

export function AgentName({
  agent,
  size = 'sm',
  className = '',
}: {
  agent: { id?: string | null; name?: string | null; role?: string | null; color?: string | null }
  size?: 'sm' | 'md'
  className?: string
}) {
  const naming = useNaming()
  const cap = naming.present({
    id: agent.id ?? '',
    name: agent.name,
    role: agent.role,
    color: agent.color,
  })
  const nameCls = size === 'md' ? 'text-[14px]' : 'text-[12px]'
  return (
    <span className={`inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 ${className}`}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cap.color }} />
      <span className={`break-words font-semibold text-mc-text ${nameCls}`}>{cap.name}</span>
      <span className="min-w-0 break-words text-[11px] font-normal text-mc-sub"> · {cap.role}</span>
    </span>
  )
}

export function Face({
  agent,
  agents,
  px = 32,
  dim = false,
}: {
  agent: AvatarAgentShape
  agents?: readonly AvatarAgentShape[]
  px?: number
  /** Dim the existing drawing. The artwork file is unchanged. */
  dim?: boolean
}) {
  const size = px >= 72 ? 1.9 : px >= 56 ? 1.5 : px >= 44 ? 1.15 : px >= 36 ? 0.95 : 0.75
  return <AgentAvatar agent={agent} agents={agents} size={size} dim={dim} />
}

export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <SoftCard className="px-6 py-10">
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-mc-sub">{body}</p>
      {children}
    </SoftCard>
  )
}

export function Banner({
  children,
  tone = 'warn',
  onDismiss,
}: {
  children: ReactNode
  tone?: 'warn' | 'ok'
  onDismiss?: () => void
}) {
  const look = tone === 'ok' ? 'bg-mc-greenbg text-mc-greentext' : 'bg-mc-orangebg text-mc-orangetext'
  return (
    <div role={tone === 'ok' ? 'status' : 'alert'} className={`mb-4 flex items-center justify-between rounded-[10px] px-4 py-2 text-[12.5px] ${look}`}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="ml-4 text-[11px] font-semibold">
          Dismiss
        </button>
      )}
    </div>
  )
}

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-mc-text px-4 py-2 text-[13px] font-medium text-mc-win shadow-lg"
    >
      <span className="mc-toast-check">✓</span>
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="text-[11px] font-semibold opacity-70">
        Dismiss
      </button>
    </div>
  )
}

export function FieldError({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[12px] font-medium text-mc-redtext">{children}</p>
}
