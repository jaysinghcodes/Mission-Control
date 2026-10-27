/**
 * Pair a device form on Team (ticket 150).
 *
 * The API is the judge: POST /devices takes `{ name, type }`, trims the
 * name, and rejects anything else with 400. The page checks the same rules
 * first so the Save button can explain a bad name without a round trip.
 */

export const DEVICE_TYPES = ['browser', 'server', 'laptop', 'phone', 'other'] as const

export type DeviceType = (typeof DEVICE_TYPES)[number]

export const DEVICE_NAME_MAX = 80

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  browser: 'Browser',
  server: 'Server',
  laptop: 'Laptop',
  phone: 'Phone',
  other: 'Other',
}

/** Copy for the Devices card and the Pair a device form. */
export const DEVICE_COPY = {
  emptyTitle: 'No devices yet',
  emptyBody: 'Add a device here with Pair a device, or wait for the bridge or npm run seed:demo.',
  formLead: 'Give the machine a name and pick its type.',
  nameLabel: 'Device name',
  typeLabel: 'Device type',
  save: 'Save device',
  saving: 'Saving…',
  cancel: 'Cancel',
  remove: 'Remove',
  nameRequired: 'Enter a device name.',
  nameTooLong: `Use ${DEVICE_NAME_MAX} characters or fewer.`,
} as const

/** The error to show for a draft, or null when it can be saved. */
export function deviceDraftError(name: string, type: string): string | null {
  const text = name.trim()
  if (!text) return DEVICE_COPY.nameRequired
  if (text.length > DEVICE_NAME_MAX) return DEVICE_COPY.nameTooLong
  if (!(DEVICE_TYPES as readonly string[]).includes(type)) return 'Pick a device type.'
  return null
}

/** The latest devices.snapshot time, or null when nothing newer than seen arrived. */
export function devicesRefreshTs(
  seenTs: number,
  events: readonly { type: string; ts: number }[],
): number | null {
  let latest = 0
  for (const event of events) {
    if (event.type === 'devices.snapshot' && event.ts > latest) latest = event.ts
  }
  return latest > seenTs ? latest : null
}
