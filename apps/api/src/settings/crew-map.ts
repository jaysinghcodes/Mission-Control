import { Prisma } from '@prisma/client';
import { SETTING_ID } from '../team/mission';
import {
  assignCrewSeats,
  crewMapsEqual,
  readCrew,
  readStoredMap,
  readStoredMode,
  registrationOrder,
  type SeatAgent,
} from './naming';

/**
 * Keeps Setting.crewMap stable while crew mode is on.
 *
 * Register, snapshot, delete, and PUT /settings take the settings row
 * lock before they read the roster or write the map. A saved seat stays.
 * A matching id takes a seat only when it is free. An agent missing from
 * the map takes the next free seat, earliest registration first. A PUT
 * that releases a seat gives it to someone who was already without one.
 * An agent that save just cleared stays clear. Display names are not read.
 */

export interface CrewSeatChange {
  /** Agent ids inserted by this register, snapshot, or seed. */
  arrived?: readonly string[];
  /** Agent ids removed by this delete, snapshot, or seed clear. */
  removed?: readonly string[];
  /**
   * PUT /settings. `previousMap` is the map before this save.
   * Only seats that save released are given out, and only to agents
   * who were already missing from that map.
   */
  releasedOnly?: boolean;
  previousMap?: Record<string, string>;
}

interface CrewSettingRow {
  namingMode?: string | null;
  crewMap?: unknown;
}

export interface CrewMapDb {
  agent: {
    findMany: () => Promise<SeatAgent[]>;
  };
  setting?: {
    findUnique: (args: {
      where: { id: string };
    }) => Promise<CrewSettingRow | null>;
    update: (args: {
      where: { id: string };
      data: { crewMap: Record<string, string> };
    }) => Promise<unknown>;
  };
  $transaction?: (
    fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => Promise<unknown>;
  $executeRaw?: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  $queryRaw?: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
}

const LOCK_ATTEMPTS = 4;

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === 'P2034') return true;
  const message = String((err as { message?: string }).message ?? '');
  return message.includes('40001');
}

async function lockSettingRow(db: CrewMapDb): Promise<void> {
  if (
    typeof db.$executeRaw !== 'function' ||
    typeof db.$queryRaw !== 'function'
  ) {
    return;
  }
  await db.$executeRaw`
    INSERT INTO "Setting" ("id", "mission", "updatedAt")
    VALUES (${SETTING_ID}, '', NOW())
    ON CONFLICT ("id") DO NOTHING
  `;
  await db.$queryRaw`
    SELECT "id" FROM "Setting" WHERE "id" = ${SETTING_ID} FOR UPDATE
  `;
}

/**
 * One transaction around the settings row. Callers read the roster and
 * write seats inside `fn`, so concurrent registers cannot drop a seat
 * or share a position. A client with no `$transaction` runs `fn` inline
 * so unit mocks stay simple. A transaction client has no `$transaction`
 * of its own, which keeps this from nesting.
 */
export async function withCrewLock<T>(
  prisma: CrewMapDb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (typeof prisma.$transaction !== 'function') {
    await lockSettingRow(prisma);
    return fn(prisma as unknown as Prisma.TransactionClient);
  }
  let last: unknown;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      return (await prisma.$transaction(async (tx) => {
        const db = tx as unknown as CrewMapDb;
        await lockSettingRow(db);
        return fn(tx);
      })) as T;
    } catch (err) {
      last = err;
      if (!isRetryable(err) || attempt === LOCK_ATTEMPTS - 1) throw err;
    }
  }
  throw last;
}

/**
 * Seats this save stopped using, in crew file order.
 * Agents who were already without a seat take them in registration order.
 * Agents who were in the previous map stay as this save left them.
 */
export function grantReleasedSeats(
  agents: readonly SeatAgent[],
  seats: readonly { id: string }[],
  proposed: Record<string, string>,
  previous: Record<string, string>,
): Record<string, string> {
  const order = seats.map((seat) => seat.id);
  const known = new Set(order);
  const used = new Set<string>();
  const next: Record<string, string> = {};
  for (const [id, seat] of Object.entries(proposed)) {
    if (!known.has(seat) || used.has(seat)) continue;
    next[id] = seat;
    used.add(seat);
  }
  const heldBefore = new Set(
    Object.values(previous).filter((seat) => known.has(seat)),
  );
  const released = order.filter(
    (seat) => heldBefore.has(seat) && !used.has(seat),
  );
  const waiting = registrationOrder(agents).filter(
    (agent) => !next[agent.id] && !(agent.id in previous),
  );
  let cursor = 0;
  for (const agent of waiting) {
    const seat = released[cursor];
    if (!seat) break;
    cursor += 1;
    next[agent.id] = seat;
  }
  return next;
}

async function applyCrewMap(
  prisma: CrewMapDb,
  change: CrewSeatChange,
): Promise<boolean> {
  const setting = prisma.setting;
  if (
    !setting ||
    typeof setting.findUnique !== 'function' ||
    typeof setting.update !== 'function'
  ) {
    return false;
  }
  const row = await setting.findUnique({ where: { id: SETTING_ID } });
  if (!row || readStoredMode(row.namingMode) !== 'crew') return false;

  let seats: { id: string }[];
  try {
    seats = readCrew();
  } catch {
    return false;
  }

  const agents = await prisma.agent.findMany();
  const living = new Set(agents.map((agent) => agent.id));
  const saved = readStoredMap(row.crewMap);
  const removed = new Set(change.removed ?? []);
  const kept: Record<string, string> = {};
  for (const [id, seat] of Object.entries(saved)) {
    if (removed.has(id) || !living.has(id)) continue;
    kept[id] = seat;
  }

  const next = change.releasedOnly
    ? grantReleasedSeats(agents, seats, kept, change.previousMap ?? {})
    : assignCrewSeats(agents, seats, kept);
  if (crewMapsEqual(next, saved)) return false;
  await setting.update({
    where: { id: SETTING_ID },
    data: { crewMap: next },
  });
  return true;
}

export async function syncCrewSeats(
  prisma: CrewMapDb,
  change: CrewSeatChange = {},
): Promise<boolean> {
  if (typeof prisma.$transaction === 'function') {
    return withCrewLock(prisma, (tx) => applyCrewMap(tx, change));
  }
  return applyCrewMap(prisma, change);
}
