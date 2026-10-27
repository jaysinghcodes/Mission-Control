import { Prisma } from '@prisma/client';
import { SETTING_ID } from '../team/mission';
import {
  assignCrewSeats,
  crewMapsEqual,
  readCrew,
  readStoredMap,
  readStoredMode,
  type SeatAgent,
} from './naming';

/**
 * Keeps Setting.crewMap stable while crew mode is on.
 *
 * Register, snapshot, delete, and PUT /settings share one lock
 * before they read the roster or write the map. A saved seat stays.
 * A matching id takes a seat only when it is free. An empty string is
 * Own name, a saved choice. It stays until a Settings save changes that
 * agent. Register, delete, restart, and sync do not seat that agent.
 * An agent with no saved choice takes the next free seat, earliest
 * registration first. A Settings save changes only the agents it names.
 * Agents it leaves out keep their seat or choice. At the end of that save
 * every agent with no saved choice takes a free seat, matching id first,
 * then registration order. That includes an agent the save just unseated.
 * Own names mode leaves the map alone, so switching back to crew restores
 * it. Display names are not read.
 */

export interface CrewSeatChange {
  /** Agent ids inserted by this register, snapshot, or seed. */
  arrived?: readonly string[];
  /** Agent ids removed by this delete, snapshot, or seed clear. */
  removed?: readonly string[];
  /**
   * PUT /settings. Only these agent ids change. An empty string is Own
   * name. Agents left out keep the seat or choice already stored.
   */
  namedMap?: Record<string, string>;
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
}

const LOCK_ATTEMPTS = 4;

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === 'P2034') return true;
  const message = String((err as { message?: string }).message ?? '');
  return message.includes('40001');
}

async function takeCrewLock(db: CrewMapDb): Promise<void> {
  if (typeof db.$executeRaw !== 'function') return;
  // A transaction advisory lock serializes seat writes without inserting
  // a settings row. An empty row would block seed:demo from saving the
  // sample mission, because that upsert leaves an existing row alone.
  // $executeRaw skips the void column Prisma cannot deserialize.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(CAST(112112 AS bigint))`;
}

/**
 * One transaction and one advisory lock. Callers read the roster and
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
    await takeCrewLock(prisma);
    return fn(prisma as unknown as Prisma.TransactionClient);
  }
  let last: unknown;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      return (await prisma.$transaction(async (tx) => {
        const db = tx as unknown as CrewMapDb;
        await takeCrewLock(db);
        return fn(tx);
      })) as T;
    } catch (err) {
      last = err;
      if (!isRetryable(err) || attempt === LOCK_ATTEMPTS - 1) throw err;
    }
  }
  throw last;
}

/** Own name. Stored on the agent id. It is not a seat id. */
const OWN_NAME = '';

function isSeat(seat: string, known: ReadonlySet<string>): boolean {
  return seat !== OWN_NAME && known.has(seat);
}

/**
 * A Settings save names some agents and leaves the rest alone.
 * An empty string sets Own name. A seat id assigns that seat.
 * If the save gives a seat to one agent while another holds it, the
 * named agent gets the seat and the holder loses it. The holder then
 * has no saved choice, unless this save sets the holder to Own name.
 * Ids no longer on the roster drop out. Then every agent with no saved
 * choice takes a free seat in this same save, matching id first, then
 * registration order. If no seat is free, that agent waits for one.
 */
export function mergeNamedCrewMap(
  agents: readonly SeatAgent[],
  seats: readonly { id: string }[],
  stored: Record<string, string>,
  named: Record<string, string>,
): Record<string, string> {
  const known = new Set(seats.map((seat) => seat.id));
  const living = new Set(agents.map((agent) => agent.id));
  const next: Record<string, string> = {};
  for (const [id, seat] of Object.entries(stored)) {
    if (!living.has(id)) continue;
    if (seat === OWN_NAME || isSeat(seat, known)) next[id] = seat;
  }
  const ownNow = new Set(
    Object.entries(named)
      .filter(([, seat]) => seat === OWN_NAME)
      .map(([id]) => id),
  );
  for (const id of ownNow) {
    if (living.has(id)) next[id] = OWN_NAME;
  }
  for (const [id, seat] of Object.entries(named)) {
    if (!living.has(id) || !isSeat(seat, known)) continue;
    const holders = Object.entries(next)
      .filter(([holder, held]) => holder !== id && held === seat)
      .map(([holder]) => holder);
    for (const holder of holders) {
      if (ownNow.has(holder)) next[holder] = OWN_NAME;
      else delete next[holder];
    }
    next[id] = seat;
  }
  // Every agent with no saved choice fills a free seat in this save,
  // the same fill a sync runs. Own name stays unseated.
  return fillOpenSeats(agents, seats, next);
}

/**
 * Saved seats stay. Own name stays. Agents with no saved choice take
 * a free seat, matching id first, then registration order.
 */
function fillOpenSeats(
  agents: readonly SeatAgent[],
  seats: readonly { id: string }[],
  kept: Record<string, string>,
): Record<string, string> {
  const known = new Set(seats.map((seat) => seat.id));
  const decided = new Set<string>();
  const saved: Record<string, string> = {};
  for (const [id, seat] of Object.entries(kept)) {
    if (seat === OWN_NAME) decided.add(id);
    else if (isSeat(seat, known)) saved[id] = seat;
  }
  const next = assignCrewSeats(agents, seats, saved, decided);
  for (const id of decided) next[id] = OWN_NAME;
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

  const next = change.namedMap
    ? mergeNamedCrewMap(agents, seats, kept, change.namedMap)
    : fillOpenSeats(agents, seats, kept);
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
