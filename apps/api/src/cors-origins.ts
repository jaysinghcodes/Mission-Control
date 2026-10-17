/**
 * CORS allowlist for Mission Control.
 *
 * The API binds to loopback only and is reached through an SSH tunnel, so the
 * browser can legitimately present EITHER localhost spelling as the page
 * origin (http://localhost:5173 or http://127.0.0.1:5173 by default). Locking to a
 * single spelling makes the Connect gate fail in the browser while curl works
 * (curl ignores CORS). MC_WEB_PORT replaces 5173 when that variable is set.
 *
 * WEB_ORIGIN may override with a comma-separated list (e.g. a deployed
 * origin). Never a wildcard: the dashboard is the only allowed consumer.
 */
const DEFAULT_WEB_PORT = '5173';

function webPort(env: NodeJS.ProcessEnv): string {
  const raw = env.MC_WEB_PORT?.trim() ?? '';
  if (!/^[0-9]+$/.test(raw)) return DEFAULT_WEB_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return DEFAULT_WEB_PORT;
  return String(port);
}

export function webOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.WEB_ORIGIN?.trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const port = webPort(env);
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}
