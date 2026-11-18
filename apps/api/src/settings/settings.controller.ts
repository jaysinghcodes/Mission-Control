import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Put,
} from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { offlineAfterMs } from '../time/runtime';
import { manualMovesName } from '../activity/activity-text';
import { boardIsLocked } from '../tickets/move-rules';
import { SETTING_ID } from '../team/mission';
import { resolveTimeZone, serverTimeZone } from '../usage/zone-time';
import { mergeNamedCrewMap, withCrewLock } from './crew-map';
import {
  crewMapsEqual,
  readCrew,
  readStoredMap,
  readStoredMode,
  type CrewSeat,
  type NamingMode,
} from './naming';
import { readSettingsPatch } from './settings-patch';

/**
 * GET /settings and PUT /settings.
 *
 * namingMode stays null until a naming choice is saved.
 * timezone stays null until a zone is saved. Reads then use the server zone.
 * setupDone stays false until the first open is finished or skipped.
 * crewMap is agent id to seat id. An empty string is Own name.
 * The web applies seats only when the mode is crew. A matching id
 * takes a free seat. A saved seat stays. Own name stays until a
 * later save changes that agent. A save changes only the agents it
 * names. After a save in crew mode, every agent with no saved choice
 * takes a free seat, so an agent the save unseated is seated again in
 * the same response. Saving own names keeps the stored map, and
 * switching back to crew restores it. PUT is a dashboard write. Loopback stays open.
 * Any other peer needs the session cookie. A crewMap key that is not
 * an agent id is 400 and changes nothing.
 * A saved PUT broadcasts settings.changed with the names of the fields it
 * carried. Every open tab then loads GET /settings again, so Office,
 * Agents and Team pick up a naming mode or seat change without a reload.
 * A rejected PUT broadcasts nothing.
 */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly live?: LiveActivityGateway,
  ) {}

  @Get()
  async get() {
    const row = await this.prisma.setting.findUnique({
      where: { id: SETTING_ID },
    });
    return this.present(row, await this.registeredCount());
  }

  @Put('/')
  async put(@Body() body: unknown) {
    const seats = readCrew();
    const patch = readSettingsPatch(body, seats);
    const row = await withCrewLock(this.prisma, async (tx) => {
      if (patch.crewMap && Object.keys(patch.crewMap).length > 0) {
        const known = new Set(
          (await tx.agent.findMany({ select: { id: true } })).map(
            (agent) => agent.id,
          ),
        );
        const missing = Object.keys(patch.crewMap)
          .filter((id) => !known.has(id))
          .sort();
        if (missing.length > 0) {
          throw new BadRequestException(`unknown agent ${missing.join(', ')}`);
        }
      }
      const existing = await tx.setting.findUnique({
        where: { id: SETTING_ID },
      });
      const previous = readStoredMap(existing?.crewMap);
      const namingMode =
        patch.namingMode !== undefined
          ? patch.namingMode
          : (existing?.namingMode ?? null);
      const touchesNames =
        patch.namingMode !== undefined || patch.crewMap !== undefined;
      // Own names keeps the stored map, so switching back restores it.
      // In crew mode every save drops ids that left the roster and
      // fills free seats for agents with no saved choice.
      let crewMap = previous;
      if (readStoredMode(namingMode) === 'crew') {
        const agents = await tx.agent.findMany();
        const named = patch.namingMode === 'crew' ? (patch.crewMap ?? {}) : {};
        crewMap = mergeNamedCrewMap(agents, seats, previous, named);
      }
      const writesMap = touchesNames || !crewMapsEqual(crewMap, previous);
      const timezone =
        patch.timezone !== undefined
          ? patch.timezone
          : (existing?.timezone ?? null);
      const setupDone =
        patch.setupDone !== undefined
          ? patch.setupDone
          : (existing?.setupDone ?? false);
      const previousManual = savedManual(existing?.manualMoves);
      const nextManual =
        patch.manualMoves !== undefined ? patch.manualMoves : previousManual;
      const saved = await tx.setting.upsert({
        where: { id: SETTING_ID },
        create: {
          id: SETTING_ID,
          mission: '',
          namingMode,
          crewMap,
          timezone,
          setupDone,
          ...(patch.manualMoves !== undefined
            ? { manualMoves: patch.manualMoves }
            : {}),
        },
        update: {
          ...(patch.namingMode !== undefined
            ? { namingMode: patch.namingMode }
            : {}),
          ...(writesMap ? { crewMap } : {}),
          ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
          ...(patch.setupDone !== undefined
            ? { setupDone: patch.setupDone }
            : {}),
          ...(patch.manualMoves !== undefined
            ? { manualMoves: patch.manualMoves }
            : {}),
        },
      });
      return { saved, previousManual, nextManual };
    });
    this.live?.broadcast('settings.changed', {
      fields: changedFields(patch),
    });
    if (row.previousManual !== row.nextManual) {
      const which =
        row.nextManual === true
          ? 'On'
          : row.nextManual === false
            ? 'Off'
            : 'Automatic';
      const name = manualMovesName(which);
      await this.persistBoardMoves(name);
      this.live?.broadcast('board.moves', { name });
    }
    return this.present(row.saved, await this.registeredCount());
  }

  private present(
    row: {
      namingMode?: string | null;
      crewMap?: unknown;
      timezone?: string | null;
      setupDone?: boolean | null;
      manualMoves?: boolean | null;
    } | null,
    registeredCount: number,
  ) {
    const seats = readCrew();
    const manualMoves = savedManual(row?.manualMoves);
    return settingsBody(
      readStoredMode(row?.namingMode),
      readStoredMap(row?.crewMap),
      seats,
      resolveTimeZone(row?.timezone),
      serverTimeZone(),
      Boolean(row?.timezone),
      Boolean(row?.setupDone),
      offlineAfterMs(),
      manualMoves,
      !boardIsLocked(manualMoves, registeredCount),
    );
  }

  private async registeredCount(): Promise<number> {
    try {
      const rows = await this.prisma.agent.findMany({
        select: { source: true },
      });
      return rows.filter((row) => row.source === 'registered').length;
    } catch {
      return 0;
    }
  }

  private async persistBoardMoves(name: string): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: {
          type: 'board.moves',
          payload: { name },
          source: 'api',
        },
      });
    } catch {
      // A missing activity table must not fail the settings save.
    }
  }
}

/** Field names a saved PUT carried, in a fixed order. Never values. */
export function changedFields(patch: {
  namingMode?: unknown;
  crewMap?: unknown;
  timezone?: unknown;
  setupDone?: unknown;
  manualMoves?: unknown;
}): string[] {
  const order = [
    'namingMode',
    'crewMap',
    'timezone',
    'setupDone',
    'manualMoves',
  ] as const;
  return order.filter((key) => patch[key] !== undefined);
}

function savedManual(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function settingsBody(
  namingMode: NamingMode | null,
  crewMap: Record<string, string>,
  seats: CrewSeat[],
  timezone: string,
  serverTimeZoneName: string,
  timezoneSaved: boolean,
  setupDone: boolean,
  offlineAfterMsValue: number,
  manualMoves: boolean | null,
  manualMovesOn: boolean,
) {
  return {
    namingMode,
    crewMap,
    seats,
    timezone,
    serverTimeZone: serverTimeZoneName,
    timezoneSaved,
    setupDone,
    offlineAfterMs: offlineAfterMsValue,
    manualMoves,
    manualMovesOn,
    ts: Date.now(),
  };
}
