import type { PrismaService } from '../prisma/prisma.service';
import type { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import type { SnapshotsService } from '../snapshots/snapshots.service';
import { IngestController } from '../ingest/ingest.controller';
import { changedFields, SettingsController } from './settings.controller';

/**
 * Issue 115. A saved PUT /settings tells every open tab to read settings
 * again. A rejected PUT tells nobody.
 */
describe('settings.changed', () => {
  function fakePrisma(agentIds: string[]) {
    let row: Record<string, unknown> | null = null;
    return {
      agent: {
        findMany: jest.fn(() => agentIds.map((id) => ({ id, name: id }))),
      },
      setting: {
        findUnique: jest.fn(() => row),
        upsert: jest.fn(
          (args: {
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) => {
            row = row ? { ...row, ...args.update } : { ...args.create };
            return row;
          },
        ),
      },
    };
  }

  function fakeLive() {
    const broadcast = jest.fn();
    return {
      live: { broadcast } as unknown as LiveActivityGateway,
      broadcast,
    };
  }

  it('a naming mode save broadcasts once with the field names', async () => {
    const { live, broadcast } = fakeLive();
    const controller = new SettingsController(
      fakePrisma(['main']) as unknown as PrismaService,
      live,
    );
    await controller.put({ namingMode: 'own' });
    expect(broadcast).toHaveBeenCalledTimes(1);
    // Own names stores an empty map, so the save names both fields.
    expect(broadcast).toHaveBeenCalledWith('settings.changed', {
      fields: ['namingMode', 'crewMap'],
    });
  });

  it('a seat save names namingMode and crewMap and never the seat values', async () => {
    const { live, broadcast } = fakeLive();
    const controller = new SettingsController(
      fakePrisma(['main', 'dev']) as unknown as PrismaService,
      live,
    );
    await controller.put({ namingMode: 'crew', crewMap: { main: 'forge' } });
    expect(broadcast).toHaveBeenCalledWith('settings.changed', {
      fields: ['namingMode', 'crewMap'],
    });
    const payload = JSON.stringify(broadcast.mock.calls[0]);
    expect(payload).not.toContain('forge');
    expect(payload).not.toContain('main"');
  });

  it('a rejected save broadcasts nothing', async () => {
    const { live, broadcast } = fakeLive();
    const controller = new SettingsController(
      fakePrisma(['main']) as unknown as PrismaService,
      live,
    );
    await expect(
      controller.put({ namingMode: 'crew', crewMap: { ghost: 'speedy' } }),
    ).rejects.toThrow(/unknown agent ghost/);
    await expect(controller.put({})).rejects.toThrow();
    await expect(controller.put({ nope: 1 })).rejects.toThrow();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('a timezone reset and a setup flag are named too', async () => {
    const { live, broadcast } = fakeLive();
    const controller = new SettingsController(
      fakePrisma([]) as unknown as PrismaService,
      live,
    );
    await controller.put({ timezone: null, setupDone: true });
    expect(broadcast).toHaveBeenCalledWith('settings.changed', {
      fields: ['timezone', 'setupDone'],
    });
  });

  it('changedFields keeps a fixed order and skips absent keys', () => {
    expect(changedFields({ setupDone: false, namingMode: 'own' })).toEqual([
      'namingMode',
      'setupDone',
    ]);
    expect(changedFields({})).toEqual([]);
  });

  it('ingest refuses settings.changed, so an agent cannot send it', async () => {
    const broadcast = jest.fn();
    const create = jest.fn();
    const controller = new IngestController(
      { broadcast } as unknown as LiveActivityGateway,
      { activityEvent: { create } } as unknown as PrismaService,
      {} as SnapshotsService,
    );
    await expect(
      controller.ingest({ type: 'settings.changed', payload: {} }),
    ).rejects.toThrow(/unknown event type "settings.changed"/);
    expect(broadcast).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
