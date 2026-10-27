/**
 * The browser port Vite baked from MC_WEB_PORT at build time.
 */

declare const __MC_WEB_PORT__: string;

function configured(value: string, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return fallback;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return String(port);
}

export const WEB_PORT = configured(__MC_WEB_PORT__, '5173');
