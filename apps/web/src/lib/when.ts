/** Doc byline clock: "Today, 9:12 AM" / "Yesterday, 4:03 PM" / "Oct 3". */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clock(d: Date): string {
  let h = d.getHours()
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`
}

export function formatDocWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  if (d >= startToday) return `Today, ${clock(d)}`
  if (d >= startYesterday) return `Yesterday, ${clock(d)}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** Local timestamp `daysAgo` before now, at a fixed clock time. */
export function atLocal(daysAgo: number, hour: number, minute: number, now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
