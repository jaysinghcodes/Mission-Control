/**
 * Team device line. Online is a live connection and is the only state
 * that counts as online. A pending request is Requested. A real last
 * seen time is Last seen. Pairing time is Paired, never Last seen.
 */

export interface DevicePresence {
  online: boolean
  lastSeenAt: string | null
  pairedAt?: string | null
  requestedAt?: string | null
}

export function deviceStatus(
  device: DevicePresence,
  format: (iso: string) => string,
): { on: boolean; status: string } {
  if (device.online) return { on: true, status: 'Online' }
  if (device.requestedAt) {
    const when = format(device.requestedAt)
    return { on: false, status: when ? `Requested ${when}` : 'Requested' }
  }
  if (device.lastSeenAt) {
    const when = format(device.lastSeenAt)
    if (when) return { on: false, status: `Last seen ${when}` }
  }
  if (device.pairedAt) {
    const when = format(device.pairedAt)
    return { on: false, status: when ? `Paired ${when}` : 'Paired' }
  }
  return { on: false, status: 'Paired' }
}
