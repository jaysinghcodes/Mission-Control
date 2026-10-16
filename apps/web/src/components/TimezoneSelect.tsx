import { canonicalTimeZone, timeZoneNames } from '../lib/timezones'

/**
 * Current names from config/timezones.json. A legacy value selects its current name.
 */
export function TimezoneSelect({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (zone: string) => void
  id: string
}) {
  const names = timeZoneNames()
  const selected = canonicalTimeZone(value) ?? value
  return (
    <select
      id={id}
      aria-label="Timezone"
      value={selected}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full max-w-md rounded-lg bg-mc-ctl px-3 text-[14px] text-mc-text"
    >
      {names.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  )
}
