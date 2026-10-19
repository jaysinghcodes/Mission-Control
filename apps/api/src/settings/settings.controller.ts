import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { offlineAfterMs } from '../time/runtime';
import { SETTING_ID } from '../team/mission';
import { resolveTimeZone, serverTimeZone } from '../usage/zone-time';
import { syncCrewSeats, withCrewLock } from './crew-map';
import {
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
 * crewMap is agent id to seat id. The web applies those seats only
 * when the mode is crew. A matching id takes a free seat. A saved
 * seat stays. A seat that opens goes to the earliest agent without
 * one. PUT is a dashboard write. Loopback stays open.
 * Any other peer needs the session cookie. A crewMap key that is not
 * an agent id is 400 and changes nothing.
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const row = await this.prisma.setting.findUnique({
      where: { id: SETTING_ID },
    });
    return this.present(row);
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
      const crewMap =
        patch.crewMap !== undefined
          ? patch.crewMap
          : readStoredMap(existing?.crewMap);
      const timezone =
        patch.timezone !== undefined
          ? patch.timezone
          : (existing?.timezone ?? null);
      const setupDone =
        patch.setupDone !== undefined
          ? patch.setupDone
          : (existing?.setupDone ?? false);
      const saved = await tx.setting.upsert({
        where: { id: SETTING_ID },
        create: {
          id: SETTING_ID,
          mission: '',
          namingMode,
          crewMap,
          timezone,
          setupDone,
        },
        update: {
          ...(patch.namingMode !== undefined
            ? {
                namingMode: patch.namingMode,
                crewMap: patch.crewMap ?? {},
              }
            : {}),
          ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
          ...(patch.setupDone !== undefined
            ? { setupDone: patch.setupDone }
            : {}),
        },
      });
      const touchesNames =
        patch.namingMode !== undefined || patch.crewMap !== undefined;
      if (touchesNames && readStoredMode(saved.namingMode) === 'crew') {
        await syncCrewSeats(tx, {
          releasedOnly: true,
          previousMap: previous,
        });
        const fresh = await tx.setting.findUnique({
          where: { id: SETTING_ID },
        });
        return fresh ?? saved;
      }
      return saved;
    });
    return this.present(row);
  }

  private present(
    row: {
      namingMode?: string | null;
      crewMap?: unknown;
      timezone?: string | null;
      setupDone?: boolean | null;
    } | null,
  ) {
    const seats = readCrew();
    return settingsBody(
      readStoredMode(row?.namingMode),
      readStoredMap(row?.crewMap),
      seats,
      resolveTimeZone(row?.timezone),
      serverTimeZone(),
      Boolean(row?.timezone),
      Boolean(row?.setupDone),
      offlineAfterMs(),
    );
  }
}

export function settingsBody(
  namingMode: NamingMode | null,
  crewMap: Record<string, string>,
  seats: CrewSeat[],
  timezone: string,
  serverTimeZoneName: string,
  timezoneSaved: boolean,
  setupDone: boolean,
  offlineAfterMsValue: number,
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
    ts: Date.now(),
  };
}
