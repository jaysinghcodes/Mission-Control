import { timeZoneNames } from '../lib/zone-day'

/**
 * IANA names from the runtime. The saved or server zone is selected.
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
  const names = timeZoneNames(value)
  return (
    <select
      id={id}
      aria-label="Timezone"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full max-w-md rounded-lg bg-mc-ctl px-3 text-[14px] text-mc-text"
    >
      {names.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  )
}
