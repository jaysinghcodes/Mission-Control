/**
 * Current zone names from config/timezones.json, the same file the API and the bridge read.
 * Legacy names convert before they are shown or saved.
 */

import timeZones from '../../../../config/timezones.json' with { type: 'json' }

const zoneSet = new Set(timeZones.zones)
const legacyNames: Record<string, string> = timeZones.legacy

/** Current name, or null when the text is not in the shared list. */
export function canonicalTimeZone(zone: string): string | null {
  const text = zone.trim()
  if (!text || text.length > 80) return null
  const mapped = legacyNames[text] ?? text
  return zoneSet.has(mapped) ? mapped : null
}

export function timeZoneNames(): string[] {
  return [...timeZones.zones].sort((a, b) => a.localeCompare(b))
}
