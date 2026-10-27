import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_ID, missionResponse, readMission } from './mission';
import { MANUAL_SOURCE, manualDeviceId, readDeviceInput } from './devices';

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
    const row = await this.prisma.setting.findUnique({
      where: { id: SETTING_ID },
    });
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
 * DevicesController. Machines on the Team page (ticket 7, ticket 150).
 *
 *  - GET /devices returns `{ devices }`. An empty table is 200 with
 *    `devices: []`, which the page renders as the empty state.
 *  - POST /devices `{ name, type }` adds a manual device. The API assigns
 *    the id. It is offline, paired now, and has no last seen or request.
 *  - DELETE /devices/:id removes any device (manual, demo, or bridge).
 *    A missing id is 404.
 *
 * Both writes are dashboard writes: loopback is open, and any other peer
 * needs the session cookie. The ingest token is not enough. Each write
 * broadcasts devices.snapshot so open Team tabs refetch.
 *
 * Sample rows come from seed:demo. Live rows come from devices.snapshot,
 * which never touches a manual row. `online` is a live connection.
 * `pairedAt` and `requestedAt` are pairing and request times, not last seen.
 */
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveActivityGateway,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.device.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return {
      devices: rows.map(presentDevice),
      ts: Date.now(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const input = readDeviceInput(body);
    const row = await this.prisma.device.create({
      data: {
        id: manualDeviceId(),
        name: input.name,
        type: input.type,
        online: false,
        lastSeenAt: null,
        pairedAt: new Date(),
        requestedAt: null,
        source: MANUAL_SOURCE,
        kind: 'device',
      },
    });
    this.emit('create', row.id, row.source);
    return { device: presentDevice(row), ts: Date.now() };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    const row = await this.prisma.device.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`device "${id}" not found`);
    const gone = await this.prisma.device.deleteMany({ where: { id } });
    if (gone.count === 0) {
      throw new NotFoundException(`device "${id}" not found`);
    }
    this.emit('delete', id, row.source);
  }

  /** Tell open Team tabs to refetch. Never fails the write. */
  private emit(action: 'create' | 'delete', id: string, source: string) {
    try {
      this.gateway.broadcast('devices.snapshot', {
        action,
        deviceId: id,
        source,
        origin: 'dashboard',
      });
    } catch {
      // The row is saved. Polling still picks it up.
    }
  }
}

type DeviceRecord = {
  id: string;
  name: string;
  type: string;
  online: boolean;
  lastSeenAt: Date | null;
  pairedAt?: Date | null;
  requestedAt?: Date | null;
  source?: string;
};

function presentDevice(row: DeviceRecord) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    online: row.online,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    pairedAt: row.pairedAt ? row.pairedAt.toISOString() : null,
    requestedAt: row.requestedAt ? row.requestedAt.toISOString() : null,
    source: row.source ?? null,
  };
}
