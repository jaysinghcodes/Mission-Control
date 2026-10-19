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
 * A new agent id takes the matching seat, or the next free seat.
 * An agent that already has a saved seat keeps it. Removing an
 * agent drops that one entry. Roster order is not read again for
 * anyone already in the map. Display names are not read.
 */

export interface CrewSeatChange {
  /** Agent ids inserted by this register, snapshot, or seed. */
  arrived?: readonly string[];
  /** Agent ids removed by this delete, snapshot, or seed clear. */
  removed?: readonly string[];
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
}

export async function syncCrewSeats(
  prisma: CrewMapDb,
  change: CrewSeatChange = {},
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

  const arrived = new Set(
    (change.arrived ?? []).filter((id) => living.has(id) && !kept[id]),
  );
  const decided = new Set<string>();
  for (const agent of agents) {
    if (!arrived.has(agent.id)) decided.add(agent.id);
  }

  const next = assignCrewSeats(agents, seats, kept, decided);
  if (crewMapsEqual(next, saved)) return false;
  await setting.update({
    where: { id: SETTING_ID },
    data: { crewMap: next },
  });
  return true;
}
