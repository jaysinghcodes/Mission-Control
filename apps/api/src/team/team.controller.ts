import { Body, Controller, Get, Put } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_ID, missionResponse, readMission } from './mission';

/**
 * MissionController — the team mission statement (ticket 7).
 *
 *  - GET /mission → `{ mission, placeholder }`
 *  - PUT /mission `{ mission }` → saves and returns the same shape
 *
 * Empty string is valid and is how the page reaches its placeholder.
 * A non-string or a mission over MISSION_MAX is 400. Last write wins.
 */
@Controller('mission')
export class MissionController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const row = await this.prisma.setting.findUnique({ where: { id: SETTING_ID } });
    return missionResponse(row?.mission ?? '');
  }

  @Put()
  async put(@Body() body: unknown) {
    const mission = readMission(body);
    const row = await this.prisma.setting.upsert({
      where: { id: SETTING_ID },
      create: { id: SETTING_ID, mission },
      update: { mission },
    });
    return missionResponse(row.mission);
  }
}

/**
 * DevicesController — machines on the Team page (ticket 7).
 *
 * GET /devices → `{ devices }`. An empty table is 200 with `devices: []`,
 * which the page renders as the empty state. There is no write route:
 * rows come from seed:demo. The bridge has no devices channel.
 */
@Controller('devices')
export class DevicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.device.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return {
      devices: rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        online: row.online,
        lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      })),
      ts: Date.now(),
    };
  }
}
