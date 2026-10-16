import { Body, Controller, Get, Put } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_ID } from '../team/mission';
import {
  readCrew,
  readNamingBody,
  readStoredMap,
  readStoredMode,
  type CrewSeat,
  type NamingMode,
} from './naming';

/**
 * GET /settings and PUT /settings.
 *
 * namingMode stays null until the first run choice is saved.
 * crewMap is agent id to seat id. The web applies those seats only
 * when the mode is crew. PUT is a write, so the shared token
 * middleware covers it the same way as every other write.
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const row = await this.prisma.setting.findUnique({
      where: { id: SETTING_ID },
    });
    return this.present(row?.namingMode, row?.crewMap);
  }

  @Put('/')
  async put(@Body() body: unknown) {
    const seats = readCrew();
    const next = readNamingBody(body, seats);
    const row = await this.prisma.setting.upsert({
      where: { id: SETTING_ID },
      create: {
        id: SETTING_ID,
        mission: '',
        namingMode: next.namingMode,
        crewMap: next.crewMap,
      },
      update: {
        namingMode: next.namingMode,
        crewMap: next.crewMap,
      },
    });
    return this.present(row.namingMode, row.crewMap);
  }

  private present(mode: string | null | undefined, map: unknown) {
    const seats = readCrew();
    return settingsBody(readStoredMode(mode), readStoredMap(map), seats);
  }
}

export function settingsBody(
  namingMode: NamingMode | null,
  crewMap: Record<string, string>,
  seats: CrewSeat[],
) {
  return {
    namingMode,
    crewMap,
    seats,
    ts: Date.now(),
  };
}
