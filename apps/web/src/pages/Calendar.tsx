import { useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, PillButton, SectionLabel } from '../components/ui'

/**
 * Calendar — Google-Calendar-style WEEK grid (review fix #8).
 *  - Times down the left, days across the top
 *  - Every real cron job is shown: timed jobs (e.g. 01:00) as blocks in their
 *    hour slot on the matching days; recurring/daily jobs on every day;
 *    interval jobs ('every 1m') as an all-day strip
 *  - Fully functional navigation: ‹ › moves weeks, "Today" jumps back,
 *    clicking a day selects it and lists that day's schedule below
 */

interface Job { id: string; name: string; schedule: string | null; day: number | null; time: string | null; color: string | null; enabled: boolean }
interface CalendarResp { jobs: Job[] }

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const HOUR_H = 32 // px per hour row
const TOTAL_H = 24 * HOUR_H

function jobColor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('brief')) return 'var(--mc-yellow)'
  if (n.includes('radar') || n.includes('peak') || n.includes('alert')) return 'var(--mc-orange)'
  if (n.includes('bridge') || n.includes('poll')) return 'var(--mc-blue)'
  if (n.includes('scan')) return 'var(--mc-green)'
  if (n.includes('write') || n.includes('quill')) return 'var(--mc-teal)'
  return 'var(--mc-purple)'
}

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // Monday start
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - day)
  return x
}

function parseTime(t: string | null): { h: number; m: number } | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  return { h, m: Number(m[2]) }
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function Calendar() {
  const { data, error } = useApi<CalendarResp>('/calendar', { pollMs: 30000 })
  const jobs = data?.jobs ?? []

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
  const [selected, setSelected] = useState<Date>(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    }),
    [weekStart],
  )

  const isToday = (d: Date) => {
    const n = new Date()
    return d.toDateString() === n.toDateString()
  }

  const monthLabel = useMemo(() => {
    const last = days[6]
    if (weekStart.getMonth() === last.getMonth()) {
      return `${weekStart.toLocaleDateString([], { month: 'long' })} ${weekStart.getFullYear()}`
    }
    return `${fmtDay(weekStart)} – ${fmtDay(last)}, ${last.getFullYear()}`
  }, [days, weekStart])

  const timedJobs = jobs.filter((j) => j.time)
  const intervalJobs = jobs.filter((j) => !j.time)

  // Jobs scheduled for a given day: day-specific jobs match the column;
  // daily jobs (day == null) repeat on every day.
  const jobsForDay = (colIdx: number) =>
    timedJobs.filter((j) => j.day == null || j.day === colIdx)

  // Selected-day detail list
  const selectedCol = (selected.getDay() + 6) % 7
  const selectedJobs = [
    ...jobsForDay(selectedCol),
    ...intervalJobs.filter((j) => j.day == null || j.day === selectedCol),
  ]

  return (
    <div className="p-6">
      {/* Header + functional nav */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[22px] font-semibold">Scheduled Tasks</div>
          <div className="mt-1 text-[13px] text-mc-sub">Every real cron job on your OpenClaw instance, week view.</div>
        </div>
        <div className="flex items-center gap-3">
          <PillButton label="Today" on={false} onClick={() => {
            const n = new Date()
            setWeekStart(startOfWeek(n))
            n.setHours(0, 0, 0, 0)
            setSelected(n)
          }} />
          <button type="button" onClick={() => setWeekStart((w) => { const x = new Date(w); x.setDate(x.getDate() - 7); return x })} className="text-[22px] leading-none text-mc-sub hover:text-mc-text">‹</button>
          <span className="text-[16px] font-semibold text-mc-text min-w-[180px] text-center">{monthLabel}</span>
          <button type="button" onClick={() => setWeekStart((w) => { const x = new Date(w); x.setDate(x.getDate() + 7); return x })} className="text-[22px] leading-none text-mc-sub hover:text-mc-text">›</button>
        </div>
      </div>

      <Card className="mt-6 rounded-2xl px-0 py-0 overflow-hidden">
        {/* Day headers — clickable */}
        <div className="flex border-b border-mc-border2">
          <div className="w-14 shrink-0" />
          {days.map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(d)}
              className={`flex-1 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] border-l border-mc-border2 transition-colors ${
                selected.toDateString() === d.toDateString() ? 'bg-mc-bluebg text-mc-bluetext' : 'text-mc-faint hover:text-mc-text'
              }`}
            >
              {DAYS[i]} · {fmtDay(d)}
              {isToday(d) && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-mc-green align-middle" />}
            </button>
          ))}
        </div>

        {/* All-day strip for interval jobs */}
        {intervalJobs.length > 0 && (
          <div className="flex border-b border-mc-border2">
            <div className="w-14 shrink-0 flex items-center justify-end pr-2 text-[9px] text-mc-faint uppercase">all-day</div>
            {days.map((_, i) => {
              const row = intervalJobs.filter((j) => j.day == null || j.day === i)
              return (
                <div key={i} className="flex-1 border-l border-mc-border2 px-1 py-1 space-y-1 min-h-[30px]">
                  {row.map((j) => (
                    <div key={j.id} title={j.schedule ?? ''} className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-white truncate" style={{ backgroundColor: j.color ?? jobColor(j.name) }}>
                      {j.name}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* Time grid */}
        <div className="relative overflow-y-auto" style={{ height: 520 }}>
          <div className="relative" style={{ height: TOTAL_H }}>
            {/* hour gridlines + labels */}
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="absolute inset-x-0 flex" style={{ top: h * HOUR_H, height: HOUR_H }}>
                <div className="w-14 shrink-0 pr-2 text-right text-[9.5px] text-mc-faint leading-none pt-1">
                  {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                </div>
                <div className="flex-1 border-t border-mc-border2/60" />
              </div>
            ))}
            {/* day column dividers */}
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="absolute top-0 bottom-0 w-px bg-mc-border2/60" style={{ left: `calc(3.5rem + ${(i / 7) * (100 - 3.5 / 8)}%)` }} />
            ))}
            {/* event blocks */}
            {days.map((_, colIdx) => (
              <div key={colIdx} className="absolute top-0 bottom-0" style={{ left: `calc(3.5rem + ${(colIdx / 7) * (100 - 3.5 / 8)}%)`, width: `calc(${100 / 7}% - ${colIdx === 6 ? 0 : 4}px)` }}>
                {jobsForDay(colIdx).map((j) => {
                  const t = parseTime(j.time)
                  if (!t) return null
                  const top = (t.h + t.m / 60) * HOUR_H
                  return (
                    <div
                      key={j.id}
                      title={`${j.name} · ${j.time} · ${j.schedule ?? ''}`}
                      className="absolute inset-x-1 rounded-md px-2 py-1 text-white overflow-hidden"
                      style={{ top: top + 2, height: HOUR_H - 4, backgroundColor: j.color ?? jobColor(j.name) }}
                    >
                      <div className="text-[10.5px] font-semibold truncate">{j.name}</div>
                      <div className="text-[9.5px] opacity-90">{j.time}</div>
                    </div>
                  )
                })}
              </div>
            ))}
            {/* today line */}
            {days.map((d, colIdx) =>
              isToday(d) ? (
                <div key={`tl-${colIdx}`} className="absolute h-px bg-mc-red z-10" style={{ left: `calc(3.5rem + ${(colIdx / 7) * (100 - 3.5 / 8)}%)`, right: 0, top: (new Date().getHours() + new Date().getMinutes() / 60) * HOUR_H }} />
              ) : null,
            )}
          </div>
        </div>
      </Card>

      {/* Selected-day schedule */}
      <Card className="mt-6 px-4 py-4">
        <SectionLabel>{selected.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</SectionLabel>
        <div className="mt-3 space-y-2">
          {selectedJobs.length === 0 && <div className="text-[12.5px] text-mc-faint">Nothing scheduled this day.</div>}
          {selectedJobs.map((j) => (
            <div key={j.id} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: j.color ?? jobColor(j.name) }} />
              <span className="font-medium">{j.name}</span>
              <span className="text-mc-faint">{j.time ? `at ${j.time}` : (j.schedule ?? '')}</span>
            </div>
          ))}
        </div>
      </Card>

      {error && <p className="mt-4 text-[12px] text-mc-faint">API unreachable — can't load the schedule.</p>}
    </div>
  )
}
