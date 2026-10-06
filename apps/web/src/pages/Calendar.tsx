import { useMemo, useState } from 'react'
import { useApi, apiPost } from '../hooks/useApi'
import { PageHeader, Segmented, SoftCard, Face, StatusChip, Btn, EmptyState } from '../components/shell'
import { agentCaption } from '../data/roster'
import type { Agent, AgentsResp } from '../types'

/**
 * Calendar — week of scheduled cron jobs. Owner robots come from the demo
 * job names (and any agent whose current task names the job). Day and month
 * are the same jobs, not a second data source.
 */

interface Job { id: string; name: string; schedule: string | null; day: number | null; time: string | null; color: string | null; enabled: boolean }
interface CalendarResp { jobs: Job[] }
interface EventApi { type: string; payload: { name?: string; agent?: string; status?: string; summary?: string } | null; ts: string }
interface ActivityResp { events: EventApi[] }

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const START_HOUR = 6
const END_HOUR = 20
const HOUR_H = 52

const OWNERS: { test: RegExp; name: string; tone: 'blue' | 'orange' | 'green' | 'teal' | 'gray' }[] = [
  { test: /brief/i, name: 'Speedy', tone: 'blue' },
  { test: /radar|trend/i, name: 'Scout', tone: 'orange' },
  { test: /review|release note/i, name: 'Quill', tone: 'green' },
  { test: /groom|backlog/i, name: 'Atlas', tone: 'teal' },
  { test: /security|scan/i, name: 'Aegis', tone: 'gray' },
  { test: /inbox|poll|bridge/i, name: 'Patch', tone: 'teal' },
]

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - day)
  return x
}

function parseTime(t: string | null): { h: number; m: number } | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return { h: Number(m[1]), m: Number(m[2]) }
}

function colOf(d: Date): number {
  return (d.getDay() + 6) % 7
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

function fmtRange(start: Date): string {
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const left = start.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const right = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${left} – ${right}`
}

function clock(h: number, m = 0): string {
  const am = h < 12
  const hr = h % 12 || 12
  return m ? `${hr}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}` : `${hr} ${am ? 'AM' : 'PM'}`
}

function ownerOf(name: string): { name: string; tone: 'blue' | 'orange' | 'green' | 'teal' | 'gray' } {
  return OWNERS.find((o) => o.test.test(name)) ?? { name: 'Speedy', tone: 'blue' }
}

function onColumn(job: Job, col: number): boolean {
  return job.day == null || job.day === col
}

export default function Calendar() {
  const { data, error } = useApi<CalendarResp>('/calendar', { pollMs: 30000 })
  const agentsQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const activityQ = useApi<ActivityResp>('/activity?limit=40', { pollMs: 30000 })
  const jobs = data?.jobs ?? []
  const agents = agentsQ.data?.agents ?? []
  const events = activityQ.data?.events ?? []

  const [view, setView] = useState(1)
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
  const [selected, setSelected] = useState<Date>(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const [ran, setRan] = useState<string | null>(null)

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  }), [weekStart])

  const now = new Date()
  const timed = jobs.filter((j) => parseTime(j.time))
  const overnight = timed.filter((j) => {
    const t = parseTime(j.time)
    return t != null && t.h < START_HOUR
  })
  const daytime = timed.filter((j) => {
    const t = parseTime(j.time)
    return t != null && t.h >= START_HOUR && t.h < END_HOUR
  })
  const allday = jobs.filter((j) => !parseTime(j.time))

  function faceFor(name: string): Agent | { id: string; name: string; status: string; role: string | null } {
    const hit = agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
    return hit ?? { id: name, name, status: 'idle', role: null }
  }

  function failed(job: Job): boolean {
    return events.some((e) => /fail/i.test(e.type) && (e.payload?.name ?? '').toLowerCase().includes(job.name.toLowerCase()))
  }

  function occurs(job: Job, day: Date): boolean {
    return onColumn(job, colOf(day))
  }

  function nextRun(job: Job, from: Date): Date | null {
    const t = parseTime(job.time)
    if (!t) return null
    for (let i = 0; i < 14; i++) {
      const d = new Date(from)
      d.setDate(from.getDate() + i)
      d.setHours(t.h, t.m, 0, 0)
      if (!onColumn(job, colOf(d))) continue
      if (d.getTime() > from.getTime()) return d
    }
    return null
  }

  const todayJobs = [...timed, ...allday].filter((j) => occurs(j, selected))
  const upcoming = jobs
    .map((job) => ({ job, at: nextRun(job, now) }))
    .filter((row): row is { job: Job; at: Date } => row.at != null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 3)

  const open = jobs.find((j) => j.id === openId) ?? null
  const history = open
    ? events.filter((e) => (e.payload?.name ?? '').toLowerCase().includes(open.name.toLowerCase())).slice(0, 4)
    : []

  const retry = jobs.some((j) => failed(j))
  const summary = data
    ? jobs.length === 0
      ? 'No scheduled jobs yet'
      : `${jobs.length} scheduled job${jobs.length === 1 ? '' : 's'}${retry ? ' · 1 retry' : ''}`
    : 'Loading the schedule…'

  function jumpToday() {
    const n = new Date()
    setWeekStart(startOfWeek(n))
    n.setHours(0, 0, 0, 0)
    setSelected(n)
  }

  function shift(dir: number) {
    setWeekStart((w) => {
      const x = new Date(w)
      x.setDate(x.getDate() + dir * 7)
      return x
    })
  }

  async function runNow(job: Job) {
    const who = ownerOf(job.name).name
    const res = await apiPost<{ run?: { id: string } }>('/runs', { name: job.name, agent: who })
    setRan(res ? 'Queued on the pipeline' : 'Could not start a run')
  }

  const hours = END_HOUR - START_HOUR
  const showNow = days.some((d) => sameDay(d, now)) && now.getHours() >= START_HOUR && now.getHours() < END_HOUR
  const nowTop = ((now.getHours() - START_HOUR) + now.getMinutes() / 60) * HOUR_H

  return (
    <div>
      <PageHeader
        title="Calendar"
        summary={summary}
        tools={
          <>
            <Segmented labels={['Day', 'Week', 'Month']} active={view} onChange={setView} ariaLabel="Calendar range" />
            <Btn onClick={jumpToday}>Today</Btn>
            <div className="flex items-center gap-1">
              <span className="mr-1 whitespace-nowrap text-[14px] font-semibold">{fmtRange(weekStart)}</span>
              <button type="button" aria-label="Previous week" onClick={() => shift(-1)} className="grid h-8 w-8 place-items-center rounded-lg bg-mc-ctl text-mc-text">‹</button>
              <button type="button" aria-label="Next week" onClick={() => shift(1)} className="grid h-8 w-8 place-items-center rounded-lg bg-mc-ctl text-mc-text">›</button>
            </div>
          </>
        }
      />

      {error && <p className="mb-4 text-[13px] text-mc-sub">The API is unreachable, so the schedule cannot load. Start the stack, then refresh.</p>}

      {data && jobs.length === 0 && (
        <EmptyState title="Nothing is scheduled" body="Connect the OpenClaw bridge to import cron jobs, or run npm run seed:demo for the six sample jobs." />
      )}

      {jobs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          {view === 2 ? (
            <MonthGrid weekStart={weekStart} jobs={jobs} selected={selected} onPick={(d) => { setSelected(d); setWeekStart(startOfWeek(d)); setView(0) }} />
          ) : view === 0 ? (
            <DayList
              day={selected}
              jobs={todayJobs}
              agents={agents}
              faceFor={faceFor}
              failed={failed}
              onOpen={setOpenId}
            />
          ) : (
            <SoftCard className="overflow-hidden px-0 py-0">
              <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
                <div />
                {days.map((d, i) => {
                  const on = sameDay(d, selected)
                  const today = sameDay(d, now)
                  return (
                    <button key={i} type="button" onClick={() => setSelected(d)} className="border-l border-mc-sep py-2 text-center">
                      <div className={`text-[10.5px] font-semibold tracking-[0.06em] ${today ? 'text-mc-accent-text' : 'text-mc-sub'}`}>{DAY_LABELS[i]}</div>
                      <div className={`mx-auto mt-1 grid h-7 w-7 place-items-center rounded-full text-[15px] font-semibold ${today ? 'bg-mc-accent-fill text-white' : 'text-mc-text'} ${on && !today ? 'ring-2 ring-mc-accent' : ''}`}>
                        {d.getDate()}
                      </div>
                    </button>
                  )
                })}
              </div>
              {allday.length > 0 && (
                <div className="grid border-t border-mc-sep" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
                  <div className="px-2 py-2 text-right text-[10.5px] font-medium text-mc-sub">all-day</div>
                  <div className="col-span-7 border-l border-mc-sep px-1 py-1">
                    {allday.map((j) => {
                      const who = ownerOf(j.name)
                      return (
                        <button key={j.id} type="button" onClick={() => setOpenId(j.id)} className="mb-1 flex w-full items-center gap-2 rounded-md bg-mc-tealbg px-2 py-1 text-left">
                          <Face agent={faceFor(who.name)} agents={agents} px={18} />
                          <span className="truncate text-[11.5px] font-semibold text-mc-tealtext">{j.name} · {j.schedule ?? 'repeating'}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {overnight.length > 0 && (
                <div className="grid border-t border-mc-sep" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
                  <div className="px-2 py-2 text-right text-[10.5px] font-medium text-mc-sub">overnight</div>
                  {days.map((d, i) => (
                    <div key={i} className="min-h-10 border-l border-mc-sep p-1">
                      {overnight.filter((j) => occurs(j, d)).map((j) => (
                        <JobBlock key={j.id} job={j} agents={agents} faceFor={faceFor} past={false} failed={failed(j)} onOpen={() => setOpenId(j.id)} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <div className="relative border-t border-mc-sep" style={{ height: hours * HOUR_H }}>
                {Array.from({ length: hours }, (_, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-mc-sep/70" style={{ top: i * HOUR_H, height: HOUR_H }}>
                    <span className="absolute left-0 w-16 pr-2 pt-1 text-right text-[10.5px] text-mc-sub">{clock(START_HOUR + i)}</span>
                  </div>
                ))}
                <div className="absolute inset-y-0 left-16 right-0 grid grid-cols-7">
                  {days.map((d, col) => (
                    <div key={col} className="relative border-l border-mc-sep">
                      {daytime.filter((j) => occurs(j, d)).map((j) => {
                        const t = parseTime(j.time)!
                        const top = ((t.h - START_HOUR) + t.m / 60) * HOUR_H + 2
                        const past = sameDay(d, now) && (t.h < now.getHours() || (t.h === now.getHours() && t.m <= now.getMinutes()))
                        return (
                          <div key={j.id} className="absolute inset-x-1" style={{ top, height: HOUR_H - 4 }}>
                            <JobBlock job={j} agents={agents} faceFor={faceFor} past={past} failed={failed(j) && sameDay(d, now)} onOpen={() => setOpenId(j.id)} />
                          </div>
                        )
                      })}
                      {showNow && sameDay(d, now) && (
                        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }}>
                          <div className="relative h-0.5 bg-mc-accent">
                            <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-mc-accent" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </SoftCard>
          )}

          <aside>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[15px] font-semibold">{sameDay(selected, now) ? 'Today' : selected.toLocaleDateString([], { weekday: 'long' })}</span>
              <span className="text-[12px] text-mc-sub">{selected.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </div>
            <div className="rounded-[14px] bg-mc-inner">
              {todayJobs.length === 0 && <p className="px-4 py-6 text-[13px] text-mc-sub">Nothing scheduled this day.</p>}
              {todayJobs.map((j, i) => {
                const who = ownerOf(j.name)
                const cap = agentCaption(who.name, faceFor(who.name).role)
                const t = parseTime(j.time)
                const past = sameDay(selected, now) && t != null && (t.h < now.getHours() || (t.h === now.getHours() && t.m <= now.getMinutes()))
                const bad = failed(j) && sameDay(selected, now)
                const tone = bad ? 'orange' : past ? 'green' : 'blue'
                const label = bad ? 'Timed out' : past ? 'Done' : 'Up next'
                return (
                  <button key={j.id} type="button" onClick={() => setOpenId(j.id)} className={`flex w-full items-center gap-3 px-3 py-3 text-left ${i > 0 ? 'border-t border-mc-sep' : ''}`}>
                    <Face agent={faceFor(who.name)} agents={agents} px={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold">{j.name}</span>
                      <span className="block text-[12px] text-mc-sub">{t ? clock(t.h, t.m) : (j.schedule ?? 'All day')} · {cap.name} · {cap.role}</span>
                    </span>
                    <StatusChip label={label} tone={tone} />
                  </button>
                )
              })}
            </div>

            <div className="mb-2 mt-5 text-[15px] font-semibold">Coming up</div>
            <div className="rounded-[14px] bg-mc-inner">
              {upcoming.length === 0 && <p className="px-4 py-6 text-[13px] text-mc-sub">No later runs this fortnight.</p>}
              {upcoming.map(({ job, at }, i) => {
                const who = ownerOf(job.name)
                const cap = agentCaption(who.name, faceFor(who.name).role)
                const when = sameDay(at, now)
                  ? `Today · ${clock(at.getHours(), at.getMinutes())}`
                  : `${at.toLocaleDateString([], { weekday: 'short' })} · ${clock(at.getHours(), at.getMinutes())}`
                return (
                  <button key={job.id} type="button" onClick={() => setOpenId(job.id)} className={`flex w-full items-center gap-3 px-3 py-3 text-left ${i > 0 ? 'border-t border-mc-sep' : ''}`}>
                    <Face agent={faceFor(who.name)} agents={agents} px={32} />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold">{job.name}</span>
                      <span className="block text-[12px] text-mc-sub">{when} · {cap.name} · {cap.role}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>
        </div>
      )}

      {open && (
        <SoftCard className="mt-4 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold">{open.name}</div>
              <p className="mt-1 text-[13px] text-mc-sub">Schedule {open.schedule ?? 'not set'}{open.time ? ` · ${open.time}` : ''} · owner {ownerOf(open.name).name}</p>
            </div>
            <div className="flex gap-2">
              <Btn kind="primary" onClick={() => void runNow(open)}>Run now</Btn>
              <Btn onClick={() => { setOpenId(null); setRan(null) }}>Close</Btn>
            </div>
          </div>
          {ran && <p className="mt-2 text-[13px] text-mc-sub">{ran}</p>}
          <div className="mt-3 text-[12px] font-semibold text-mc-sub">Recent history</div>
          {history.length === 0 && <p className="mt-1 text-[13px] text-mc-sub">No matching activity yet.</p>}
          {history.map((e, i) => (
            <p key={i} className="mt-1 text-[13px] text-mc-text">{e.type} · {e.payload?.summary || e.payload?.status || 'recorded'} · {new Date(e.ts).toLocaleString()}</p>
          ))}
        </SoftCard>
      )}
    </div>
  )
}

function JobBlock({
  job,
  agents,
  faceFor,
  past,
  failed,
  onOpen,
}: {
  job: Job
  agents: Agent[]
  faceFor: (name: string) => Agent | { id: string; name: string; status: string; role: string | null }
  past: boolean
  failed: boolean
  onOpen: () => void
}) {
  const who = ownerOf(job.name)
  const tone = failed ? 'orange' : who.tone
  const bg = {
    blue: 'bg-mc-bluebg text-mc-bluetext',
    orange: 'bg-mc-orangebg text-mc-orangetext',
    green: 'bg-mc-greenbg text-mc-greentext',
    teal: 'bg-mc-tealbg text-mc-tealtext',
    gray: 'bg-mc-fill text-mc-graytext',
  }[tone]
  const t = parseTime(job.time)
  return (
    <button type="button" title={job.name} onClick={onOpen} className={`flex h-full w-full flex-col justify-between overflow-hidden rounded-md px-1.5 py-0.5 text-left ${bg} ${past ? 'opacity-70' : ''} ${failed ? 'border border-dashed border-mc-orange' : ''}`}>
      <span className="line-clamp-2 text-[11px] font-semibold leading-[13px]">{job.name}</span>
      <span className="flex items-center gap-1">
        <Face agent={faceFor(who.name)} agents={agents} px={14} />
        <span className="truncate text-[10px]">{failed ? 'Timed out' : t ? clock(t.h, t.m) : ''}</span>
      </span>
    </button>
  )
}

function DayList({
  day,
  jobs,
  agents,
  faceFor,
  failed,
  onOpen,
}: {
  day: Date
  jobs: Job[]
  agents: Agent[]
  faceFor: (name: string) => Agent | { id: string; name: string; status: string; role: string | null }
  failed: (job: Job) => boolean
  onOpen: (id: string) => void
}) {
  return (
    <SoftCard className="px-4 py-4">
      <div className="text-[15px] font-semibold">{day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      {jobs.length === 0 && <p className="mt-3 text-[13px] text-mc-sub">Nothing scheduled.</p>}
      <div className="mt-3 space-y-2">
        {jobs.map((j) => {
          const who = ownerOf(j.name)
          const t = parseTime(j.time)
          return (
            <button key={j.id} type="button" onClick={() => onOpen(j.id)} className="flex w-full items-center gap-3 rounded-xl bg-mc-inner px-3 py-3 text-left">
              <Face agent={faceFor(who.name)} agents={agents} px={36} />
              <span>
                <span className="block text-[14px] font-semibold">{j.name}</span>
                <span className="block text-[12px] text-mc-sub">{t ? clock(t.h, t.m) : (j.schedule ?? 'All day')} · {who.name}{failed(j) ? ' · Timed out' : ''}</span>
              </span>
            </button>
          )
        })}
      </div>
    </SoftCard>
  )
}

function MonthGrid({
  weekStart,
  jobs,
  selected,
  onPick,
}: {
  weekStart: Date
  jobs: Job[]
  selected: Date
  onPick: (d: Date) => void
}) {
  const first = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1)
  const start = startOfWeek(first)
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
  return (
    <SoftCard className="px-4 py-4">
      <div className="mb-3 text-[15px] font-semibold">{weekStart.toLocaleDateString([], { month: 'long', year: 'numeric' })}</div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-semibold text-mc-sub">
        {DAY_LABELS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const count = jobs.filter((j) => j.day == null || j.day === colOf(d)).length
          const inMonth = d.getMonth() === weekStart.getMonth()
          const on = sameDay(d, selected)
          return (
            <button key={i} type="button" onClick={() => onPick(d)} className={`h-14 rounded-lg text-left ${on ? 'bg-mc-accent-fill text-white' : 'bg-mc-inner text-mc-text'} ${inMonth ? '' : 'opacity-40'}`}>
              <span className="block px-2 pt-1 text-[12px] font-semibold">{d.getDate()}</span>
              {count > 0 && <span className={`block px-2 text-[10px] ${on ? 'text-white' : 'text-mc-sub'}`}>{count} jobs</span>}
            </button>
          )
        })}
      </div>
    </SoftCard>
  )
}
