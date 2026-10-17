/**
 * Native API listen port.
 *
 * PORT is the process listen port. MC_API_PORT is the Compose host port and
 * is also accepted on the native path when PORT is unset. When both are set,
 * PORT wins. Compose still forces PORT 3000 inside the api container.
 */

function hasText(raw: string | undefined): boolean {
  return typeof raw === 'string' && raw.trim() !== '';
}

function readPort(raw: string | undefined): number | null {
  if (!hasText(raw)) return null;
  const port = Number(raw!.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/** Port the API process should bind. Invalid text throws. */
export function apiListenPort(env: NodeJS.ProcessEnv = process.env): number {
  if (hasText(env.PORT)) {
    const port = readPort(env.PORT);
    if (port === null) {
      throw new Error('PORT is not a valid port number.');
    }
    return port;
  }
  if (hasText(env.MC_API_PORT)) {
    const port = readPort(env.MC_API_PORT);
    if (port === null) {
      throw new Error('MC_API_PORT is not a valid port number.');
    }
    return port;
  }
  return 3000;
}
