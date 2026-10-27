import { promiseFn } from '../../test/lint-helpers';
import {
  deviceRowsFromPayload,
  keepManualDevices,
  SnapshotsService,
} from './snapshots.service';
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

type DeviceRow = {
  id: string;
  name: string;
  type: string;
  online: boolean;
  lastSeenAt: Date | null;
  source: string;
  kind: string;
};

type DeviceWhere = {
  source?: string;
  kind?: string;
  id?: { in: string[] };
};

function matches(row: DeviceRow, where: DeviceWhere | undefined): boolean {
  if (!where) return true;
  if (where.source && row.source !== where.source) return false;
  if (where.kind && row.kind !== where.kind) return false;
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  return true;
}

function makePrisma(seed: DeviceRow[] = []) {
  const devices: DeviceRow[] = [...seed];
  const tx = {
    device: {
      findMany: jest.fn(
        promiseFn(({ where }: { where?: DeviceWhere }) =>
          devices
            .filter((row) => matches(row, where))
            .map((row) => ({ id: row.id })),
        ),
      ),
      deleteMany: jest.fn(
        promiseFn(({ where }: { where?: DeviceWhere }) => {
          const before = devices.length;
          const keep = devices.filter((row) => !matches(row, where));
          devices.splice(0, devices.length, ...keep);
          return { count: before - devices.length };
        }),
      ),
      createMany: jest.fn(
        promiseFn(({ data }: { data: DeviceRow[] }) => {
          devices.push(...data);
          return { count: data.length };
        }),
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      promiseFn((fn: (client: typeof tx) => Promise<void>) => fn(tx)),
    ),
  } as unknown as PrismaService;
  return { prisma, devices };
}

const DEMO: DeviceRow = {
  id: 'demo-device-studio',
  name: 'Studio display',
  type: 'browser',
  online: true,
  lastSeenAt: null,
  source: 'demo',
  kind: 'device',
};

describe('devices.snapshot', () => {
  it('ignores a payload that has neither array', () => {
    expect(deviceRowsFromPayload({})).toBeNull();
    expect(deviceRowsFromPayload({ devices: 'nope' })).toBeNull();
  });

  it('drops a demo id and a non object', () => {
    const parsed = deviceRowsFromPayload({
      devices: [
        {
          id: 'demo-device-studio',
          name: 'Stolen',
          type: 'laptop',
          online: true,
        },
        'skip',
        { id: 'mac-1', name: 'Kitchen Mac', type: 'operator', online: true },
      ],
    });
    expect(parsed?.rows.map((row) => row.id)).toEqual(['mac-1']);
    expect(parsed?.rows[0]).toMatchObject({
      name: 'Kitchen Mac',
      type: 'operator',
      online: true,
      source: 'bridge',
      kind: 'device',
    });
  });

  it('lets a node row replace a device row with the same id', () => {
    const parsed = deviceRowsFromPayload({
      devices: [
        {
          id: 'mac-1',
          name: 'Kitchen Mac',
          type: 'operator',
          online: true,
          lastSeenAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      nodes: [
        {
          id: 'mac-1',
          name: 'Kitchen Mac',
          type: 'macos',
          online: false,
          lastSeenAt: 1_700_000_000_000,
          pairedAt: '2026-10-01T00:00:00.000Z',
          requestedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    expect(parsed?.rows).toHaveLength(1);
    expect(parsed?.rows[0].kind).toBe('node');
    expect(parsed?.rows[0].type).toBe('macos');
    expect(parsed?.rows[0].online).toBe(false);
    expect(parsed?.rows[0].lastSeenAt?.toISOString()).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
    expect(parsed?.rows[0].pairedAt?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(parsed?.rows[0].requestedAt?.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('drops last seen while the machine is online', () => {
    const parsed = deviceRowsFromPayload({
      devices: [
        {
          id: 'mac-1',
          name: 'Kitchen Mac',
          type: 'operator',
          online: true,
          lastSeenAt: '2026-10-16T12:00:00.000Z',
          pairedAt: '2023-07-22T00:00:00.000Z',
        },
      ],
    });
    expect(parsed?.rows[0].online).toBe(true);
    expect(parsed?.rows[0].lastSeenAt).toBeNull();
    expect(parsed?.rows[0].pairedAt?.toISOString()).toBe(
      '2023-07-22T00:00:00.000Z',
    );
  });

  it('replaces sample devices and keeps the other kind when one array is missing', async () => {
    const node: DeviceRow = {
      id: 'phone-1',
      name: 'Pocket',
      type: 'ios',
      online: false,
      lastSeenAt: new Date('2026-10-16T12:00:00.000Z'),
      source: 'bridge',
      kind: 'node',
    };
    const { prisma, devices } = makePrisma([DEMO, node]);
    await new SnapshotsService(prisma).applyDevices({
      devices: [
        { id: 'mac-1', name: 'Kitchen Mac', type: 'operator', online: true },
      ],
    });
    expect(devices.map((row) => row.id).sort()).toEqual(['mac-1', 'phone-1']);
    expect(devices.find((row) => row.id === 'mac-1')).toMatchObject({
      source: 'bridge',
      kind: 'device',
      online: true,
    });
  });

  it('clears bridge devices when the devices array is empty and leaves nodes', async () => {
    const { prisma, devices } = makePrisma([
      DEMO,
      {
        id: 'mac-1',
        name: 'Kitchen Mac',
        type: 'operator',
        online: true,
        lastSeenAt: null,
        source: 'bridge',
        kind: 'device',
      },
      {
        id: 'phone-1',
        name: 'Pocket',
        type: 'ios',
        online: true,
        lastSeenAt: null,
        source: 'bridge',
        kind: 'node',
      },
    ]);
    await new SnapshotsService(prisma).applyDevices({ devices: [] });
    expect(devices.map((row) => row.id)).toEqual(['phone-1']);
  });

  it('does nothing when neither array is present', async () => {
    const { prisma, devices } = makePrisma([DEMO]);
    await new SnapshotsService(prisma).applyDevices({ extra: true });
    expect(devices).toEqual([DEMO]);
  });

  it('skips a bridge id that matches a manual id', () => {
    const parsed = deviceRowsFromPayload({
      devices: [
        { id: 'manual-1', name: 'Imposter', type: 'server' },
        { id: 'mac-1', name: 'Kitchen Mac', type: 'operator' },
      ],
    });
    const skipped: string[] = [];
    const kept = keepManualDevices(
      parsed?.rows ?? [],
      [{ id: 'manual-1' }],
      skipped,
    );
    expect(kept.map((row) => row.id)).toEqual(['mac-1']);
    expect(skipped).toEqual(['manual-1']);
  });

  it('keeps a manual device through a snapshot of other bridge devices and through sample clearing', async () => {
    const manual: DeviceRow = {
      id: 'manual-abc',
      name: 'Field laptop',
      type: 'laptop',
      online: false,
      lastSeenAt: null,
      source: 'manual',
      kind: 'device',
    };
    const { prisma, devices } = makePrisma([DEMO, manual]);
    await new SnapshotsService(prisma).applyDevices({
      devices: [
        { id: 'mac-1', name: 'Kitchen Mac', type: 'operator', online: true },
      ],
      nodes: [],
    });
    expect(devices.map((row) => row.id).sort()).toEqual([
      'mac-1',
      'manual-abc',
    ]);
    expect(devices.find((row) => row.id === 'manual-abc')).toEqual(manual);

    await new SnapshotsService(prisma).applyDevices({ devices: [], nodes: [] });
    expect(devices).toEqual([manual]);
  });

  it('does not revive a deleted manual device', async () => {
    const { prisma, devices } = makePrisma([DEMO]);
    await new SnapshotsService(prisma).applyDevices({ devices: [] });
    expect(devices).toEqual([]);
  });

  it('leaves a colliding manual row alone, applies the rest, and logs once', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const manual: DeviceRow = {
      id: 'manual-abc',
      name: 'Field laptop',
      type: 'laptop',
      online: false,
      lastSeenAt: null,
      source: 'manual',
      kind: 'device',
    };
    const { prisma, devices } = makePrisma([manual]);
    await new SnapshotsService(prisma).applyDevices({
      devices: [
        { id: 'manual-abc', name: 'Bridge copy', type: 'server', online: true },
        { id: 'mac-1', name: 'Kitchen Mac', type: 'operator', online: true },
      ],
      nodes: [{ id: 'manual-abc', name: 'Node copy', type: 'macos' }],
    });
    expect(devices.find((row) => row.id === 'manual-abc')).toEqual(manual);
    expect(devices.map((row) => row.id).sort()).toEqual([
      'mac-1',
      'manual-abc',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('manual-abc');
    warn.mockRestore();
  });
});
