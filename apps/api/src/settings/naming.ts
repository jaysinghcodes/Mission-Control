import { BadRequestException } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Naming choice for the roster.
 *
 * config/crew.json is the shipped crew (name, role, desk, color).
 * A saved map points an agent id at a seat id. An id that equals a
 * free seat id takes that seat. A saved seat stays with that agent.
 * Other agents take the next free seat in the order they first
 * registered. Nothing here matches a display name or a role keyword.
 * Own names mode ignores the map.
 */

export interface CrewSeat {
  id: string;
  name: string;
  role: string;
  desk: string;
  color: string;
}

export type NamingMode = 'crew' | 'own';

const SEAT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAP_MAX = 200;
const KEY_MAX = 200;

function crewFile(): string {
  const override = process.env.MC_CREW_FILE?.trim();
  if (override) return override;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'config', 'crew.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), 'config', 'crew.json');
}

export function parseCrew(raw: unknown): CrewSeat[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('crew file must be an object with seats');
  }
  const seatsRaw = (raw as { seats?: unknown }).seats;
  if (!Array.isArray(seatsRaw) || seatsRaw.length === 0) {
    throw new Error('crew file seats must be a non empty list');
  }
  const seen = new Set<string>();
  const seats: CrewSeat[] = [];
  for (const row of seatsRaw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('each crew seat must be an object');
    }
    const seat = row as Record<string, unknown>;
    const id = typeof seat.id === 'string' ? seat.id.trim() : '';
    const name = typeof seat.name === 'string' ? seat.name.trim() : '';
    const role = typeof seat.role === 'string' ? seat.role.trim() : '';
    const desk = typeof seat.desk === 'string' ? seat.desk.trim() : '';
    const color = typeof seat.color === 'string' ? seat.color.trim() : '';
    if (!SEAT_ID.test(id))
      throw new Error(`bad crew seat id ${id || '(blank)'}`);
    if (!name || !role || !desk)
      throw new Error(`crew seat ${id} needs a name, role, and desk`);
    if (!COLOR.test(color))
      throw new Error(`crew seat ${id} needs a #rrggbb color`);
    if (seen.has(id)) throw new Error(`duplicate crew seat ${id}`);
    seen.add(id);
    seats.push({ id, name, role, desk, color });
  }
  return seats;
}

export function readCrew(file: string = crewFile()): CrewSeat[] {
  const text = readFileSync(file, 'utf8');
  return parseCrew(JSON.parse(text) as unknown);
}

export function readStoredMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, seat] of Object.entries(value)) {
    if (typeof seat === 'string') out[key] = seat;
  }
  return out;
}

export function readStoredMode(
  value: string | null | undefined,
): NamingMode | null {
  if (value === 'crew' || value === 'own') return value;
  return null;
}

export interface SeatAgent {
  id: string;
  /** Set once when the row is created. Later roster order does not change it. */
  position?: number | null;
}

/** First registration order. Position is assigned once. Id breaks a tie. */
export function registrationOrder<T extends SeatAgent>(
  agents: readonly T[],
): T[] {
  return [...agents].sort((a, b) => {
    const pa = a.position ?? 0;
    const pb = b.position ?? 0;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Crew seats by agent id.
 *
 * An agent whose id equals a free seat id takes that seat.
 * A saved seat stays, so a later id match cannot take it.
 * Everyone else takes the next free seat in registration order.
 * Agents in `decided` stay on their own name.
 * Display names are not read. An empty string in a stored map is Own name.
 * The same function lives in apps/web/src/lib/crew.ts.
 */
export function assignCrewSeats(
  agents: readonly SeatAgent[],
  seats: readonly { id: string }[],
  saved: Record<string, string> = {},
  decided?: ReadonlySet<string> | null,
): Record<string, string> {
  const ordered = registrationOrder(agents);
  const seatIds = seats.map((seat) => seat.id);
  const known = new Set(seatIds);
  const used = new Set<string>();
  const map: Record<string, string> = {};
  const locked = decided ?? new Set<string>();

  for (const agent of ordered) {
    const seat = saved[agent.id];
    if (!seat || !known.has(seat) || used.has(seat)) continue;
    map[agent.id] = seat;
    used.add(seat);
  }

  const fresh = ordered.filter(
    (agent) => !map[agent.id] && !locked.has(agent.id),
  );
  for (const agent of fresh) {
    if (!known.has(agent.id) || used.has(agent.id)) continue;
    map[agent.id] = agent.id;
    used.add(agent.id);
  }

  const free = seatIds.filter((id) => !used.has(id));
  let cursor = 0;
  for (const agent of fresh) {
    if (map[agent.id]) continue;
    const seat = free[cursor];
    if (!seat) break;
    cursor += 1;
    map[agent.id] = seat;
  }
  return map;
}

export function crewMapsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  if (a.length !== b.length) return false;
  return a.every((key, index) => key === b[index] && left[key] === right[key]);
}

/**
 * PUT /settings body. namingMode is required. crewMap is optional and
 * defaults to an empty object. Seat ids must exist in the crew file.
 * The same seat cannot be given to two agents.
 */
export function readNamingBody(
  body: unknown,
  seats: readonly CrewSeat[],
): { namingMode: NamingMode; crewMap: Record<string, string> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('namingMode is required');
  }
  const payload = body as Record<string, unknown>;
  const unknown = Object.keys(payload).filter(
    (key) => key !== 'namingMode' && key !== 'crewMap',
  );
  if (unknown.length > 0) {
    const label = unknown.length === 1 ? 'unknown field' : 'unknown fields';
    throw new BadRequestException(`${label} ${unknown.join(', ')}`);
  }
  const mode = payload.namingMode;
  if (mode !== 'crew' && mode !== 'own') {
    throw new BadRequestException('namingMode must be crew or own');
  }
  if (!('crewMap' in payload) || payload.crewMap == null) {
    return { namingMode: mode, crewMap: {} };
  }
  if (typeof payload.crewMap !== 'object' || Array.isArray(payload.crewMap)) {
    throw new BadRequestException('crewMap must be an object');
  }
  const entries = Object.entries(payload.crewMap);
  if (entries.length > MAP_MAX) {
    throw new BadRequestException(
      `crewMap must have at most ${MAP_MAX} agents`,
    );
  }
  const known = new Set(seats.map((seat) => seat.id));
  const used = new Set<string>();
  const crewMap: Record<string, string> = {};
  for (const [rawKey, rawSeat] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > KEY_MAX) {
      throw new BadRequestException('crewMap keys must be agent ids');
    }
    if (typeof rawSeat !== 'string') {
      throw new BadRequestException('crewMap values must be seat ids');
    }
    const seat = rawSeat.trim();
    // Empty string is Own name, a saved choice, not a seat id.
    if (!seat) {
      crewMap[key] = '';
      continue;
    }
    if (!known.has(seat)) {
      throw new BadRequestException(`unknown crew seat ${seat}`);
    }
    if (used.has(seat)) {
      throw new BadRequestException(
        `crew seat ${seat} is assigned more than once`,
      );
    }
    used.add(seat);
    crewMap[key] = seat;
  }
  return { namingMode: mode, crewMap };
}
