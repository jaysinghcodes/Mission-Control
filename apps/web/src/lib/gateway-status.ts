/**
 * System gateway line. The probe result comes from GET /system.
 * A down probe explains how to set the two documented variables.
 * Defaults match docker-compose.yml and gateway-probe.ts.
 */

export const GATEWAY_DOWN_HINT =
  'Gateway not reachable. Set OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT. Under Compose the default host is host.docker.internal. Outside Compose the default host is 127.0.0.1. The default port is 18789.'

export interface GatewayProbeView {
  host: string
  port: number
  up: boolean
  latencyMs: number | null
}

export function gatewayLine(gw: GatewayProbeView | undefined): { value: string; ok: boolean; hint: string } {
  if (!gw) return { value: 'Waiting', ok: false, hint: '' }
  const where = `${gw.host}:${gw.port}`
  if (gw.up) {
    const latency = gw.latencyMs != null ? `, ${gw.latencyMs} ms` : ''
    return { value: `Up at ${where}${latency}`, ok: true, hint: '' }
  }
  return { value: `Down at ${where}`, ok: false, hint: GATEWAY_DOWN_HINT }
}
