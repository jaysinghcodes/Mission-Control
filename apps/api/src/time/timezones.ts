import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * config/timezones.json is the zone list shared with the web app and the bridge.
 * `zones` are current names. `legacy` maps an old ICU name onto one of those.
 */

interface TimeZoneTable {
  zones: Set<string>;
  legacy: Map<string, string>;
}

let cached: TimeZoneTable | null = null;

export function timeZonesFile(): string {
  const override = process.env.MC_TIMEZONES_FILE?.trim();
  if (override) return override;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'config', 'timezones.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), 'config', 'timezones.json');
}

function loadTimeZones(): TimeZoneTable {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(timeZonesFile(), 'utf8')) as {
    zones?: unknown;
    legacy?: unknown;
  };
  const zones = new Set<string>();
  if (Array.isArray(raw.zones)) {
    for (const name of raw.zones) {
      if (typeof name === 'string' && name) zones.add(name);
    }
  }
  const legacy = new Map<string, string>();
  if (
    raw.legacy &&
    typeof raw.legacy === 'object' &&
    !Array.isArray(raw.legacy)
  ) {
    for (const [from, to] of Object.entries(raw.legacy)) {
      if (typeof to === 'string' && zones.has(to)) legacy.set(from, to);
    }
  }
  cached = { zones, legacy };
  return cached;
}

/** Current name, or null when the text is not in the shared list. */
export function canonicalTimeZone(zone: string): string | null {
  const text = zone.trim();
  if (!text || text.length > 80) return null;
  const table = loadTimeZones();
  const mapped = table.legacy.get(text) ?? text;
  return table.zones.has(mapped) ? mapped : null;
}

export function timeZoneNames(): string[] {
  return [...loadTimeZones().zones].sort((a, b) => a.localeCompare(b));
}
