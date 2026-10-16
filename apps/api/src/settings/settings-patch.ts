import { BadRequestException } from '@nestjs/common';
import { canonicalTimeZone } from '../time/timezones';
import { readNamingBody, type CrewSeat, type NamingMode } from './naming';

/**
 * PUT /settings accepts any mix of the first run fields.
 * Unknown keys are rejected. An empty object is rejected.
 * Naming still requires namingMode when a name field is present.
 */

export interface SettingsPatch {
  namingMode?: NamingMode;
  crewMap?: Record<string, string>;
  /** Null clears a saved zone and returns to the server timezone. */
  timezone?: string | null;
  setupDone?: boolean;
}

const ALLOWED = new Set(['namingMode', 'crewMap', 'timezone', 'setupDone']);

export function readSettingsPatch(
  body: unknown,
  seats: readonly CrewSeat[],
): SettingsPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('settings body is required');
  }
  const payload = body as Record<string, unknown>;
  const unknown = Object.keys(payload).filter((key) => !ALLOWED.has(key));
  if (unknown.length > 0) {
    const label = unknown.length === 1 ? 'unknown field' : 'unknown fields';
    throw new BadRequestException(`${label} ${unknown.join(', ')}`);
  }
  if (Object.keys(payload).length === 0) {
    throw new BadRequestException('settings body is required');
  }

  const patch: SettingsPatch = {};
  if ('namingMode' in payload || 'crewMap' in payload) {
    const naming = readNamingBody(
      {
        namingMode: payload.namingMode,
        ...('crewMap' in payload ? { crewMap: payload.crewMap } : {}),
      },
      seats,
    );
    patch.namingMode = naming.namingMode;
    patch.crewMap = naming.crewMap;
  }
  if ('timezone' in payload) {
    patch.timezone = readTimezone(payload.timezone);
  }
  if ('setupDone' in payload) {
    if (typeof payload.setupDone !== 'boolean') {
      throw new BadRequestException('setupDone must be true or false');
    }
    patch.setupDone = payload.setupDone;
  }
  return patch;
}

function readTimezone(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('timezone must be an IANA name');
  }
  const text = value.trim();
  if (!text) return null;
  const zone = canonicalTimeZone(text);
  if (!zone) {
    throw new BadRequestException('timezone must be an IANA name');
  }
  return zone;
}
