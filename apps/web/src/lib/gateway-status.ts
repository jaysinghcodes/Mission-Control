/**
 * System gateway line. GET /system sends state up, down, or unknown.
 * Unknown means no real check. Down means a probe or a fresh bridge report
 * failed. The header must not claim everything is running in those cases.
 */

export const GATEWAY_UNKNOWN_HINT =
  'Gateway status comes from the bridge. Run the bridge to check it.'

export interface GatewayProbeView {
  host: string
  port: number
  up: boolean
  latencyMs: number | null
  state?: 'up' | 'down' | 'unknown'
}

export function gatewayLine(gw: GatewayProbeView | undefined): { value: string; ok: boolean; hint: string } {
  if (!gw) return { value: 'Waiting', ok: false, hint: '' }
  const state = gw.state ?? (gw.up ? 'up' : 'down')
  if (state === 'unknown') {
    return { value: 'Unknown', ok: false, hint: GATEWAY_UNKNOWN_HINT }
  }
  const where = `${gw.host}:${gw.port}`
  if (state === 'up') {
    const latency = gw.latencyMs != null ? `, ${gw.latencyMs} ms` : ''
    return { value: `Up at ${where}${latency}`, ok: true, hint: '' }
  }
  return { value: `Down at ${where}`, ok: false, hint: '' }
}

/** Headline for the System header. healthOk null means /health has not loaded. */
export function systemHeadline(healthOk: boolean | null, gw: GatewayProbeView | undefined): string {
  if (healthOk === null || !gw) return 'Checking…'
  if (!healthOk) return 'The API is unhappy'
  const state = gw.state ?? (gw.up ? 'up' : 'down')
  if (state === 'unknown') return 'Gateway status is unknown'
  if (state === 'down') return 'The gateway is down'
  return "Everything's running"
}

export function systemSummaryLead(healthOk: boolean, gw: GatewayProbeView | undefined): string {
  if (!healthOk) return 'Degraded'
  if (!gw) return 'All systems normal'
  const state = gw.state ?? (gw.up ? 'up' : 'down')
  if (state === 'unknown') return 'Gateway status is unknown'
  if (state === 'down') return 'The gateway is down'
  return 'All systems normal'
}
