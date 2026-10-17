/**
 * Ports baked by Vite from the process environment.
 * MC_WEB_PORT is the browser port. PORT is the native API listen port.
 * MC_API_PORT fills in when PORT is unset.
 */

declare const __MC_WEB_PORT__: string;
declare const __MC_API_PORT__: string;

function configured(value: string, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return fallback;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return String(port);
}

export const WEB_PORT = configured(__MC_WEB_PORT__, '5173');
export const API_PORT = configured(__MC_API_PORT__, '3000');
