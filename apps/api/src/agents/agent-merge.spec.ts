import { readFileSync } from 'fs';
import { join } from 'path';
import {
  NAME_MAX,
  offlineAfterMs,
  SNAPSHOT_ID,
  backfillSource,
  isOnline,
  normalizeSnapshotAgents,
  planDelete,
  planHeartbeat,
  planRegister,
  planSnapshot,
  slugFromName,
  type RosterAgent,
} from './agent-merge';

function row(
  partial: Partial<RosterAgent> & Pick<RosterAgent, 'id' | 'name' | 'source'>,
): RosterAgent {
  return {
    color: '#58A6FF',
    role: null,
    status: 'idle',
    parentId: null,
    emoji: null,
    personalityTags: null,
    currentTask: null,
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: null,
    channel: null,
    model: null,
    avatar: null,
    position: 0,
    lastSeenAt: null,
    ...partial,
  };
}

const now = new Date('2026-10-12T18:00:00.000Z');

describe('agent merge', () => {
  it('criterion 1: a new id is registered once and a second register updates it', () => {
    const created = planRegister(
      [],
      { id: 'forge_helper', name: 'Forge Helper' },
      now,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.created).toBe(true);
    expect(created.row.source).toBe('registered');
    expect(created.row.lastSeenAt).toEqual(now);

    const updated = planRegister(
      [created.row],
      { id: 'forge_helper', name: 'Forge Helper', model: 'local' },
      now,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.created).toBe(false);
    expect(updated.row.model).toBe('local');
    expect(updated.row.id).toBe('forge_helper');
    const again = planRegister(
      [updated.row],
      { id: 'forge_helper', name: 'Forge Helper' },
      now,
    );
    expect(again.ok && !again.created).toBe(true);
  });

  it('a new id may use a display name another bot already has', () => {
    const crew = row({
      id: 'forge',
      name: 'Forge',
      source: 'default',
      role: 'engineer',
      status: 'working',
      color: '#9bd434',
    });
    const plan = planRegister(
      [crew],
      { id: 'rogue_forge', name: 'Forge', role: 'helper' },
      now,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.created).toBe(true);
    expect(plan.row.id).toBe('rogue_forge');
    expect(plan.row.name).toBe('Forge');
    expect(plan.row.role).toBe('helper');
    expect(plan.row.color).toBe('#58A6FF');
    expect(plan.row.status).toBe('idle');
  });

  it('criterion 2: registering a default id keeps position and visual', () => {
    const forge = row({
      id: 'forge',
      name: 'Forge',
      source: 'default',
      role: 'engineer',
      color: '#9bd434',
      emoji: '🛠️',
      avatar: 'robot-forge',
      position: 2,
      parentId: 'speedy',
      status: 'working',
    });
    const plan = planRegister(
      [forge],
      { id: 'forge', name: 'Forge', model: 'local' },
      now,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.created).toBe(false);
    expect(plan.row.source).toBe('registered');
    expect(plan.row.position).toBe(2);
    expect(plan.row.color).toBe('#9bd434');
    expect(plan.row.emoji).toBe('🛠️');
    expect(plan.row.avatar).toBe('robot-forge');
    expect(plan.row.role).toBe('engineer');
    expect(plan.row.parentId).toBe('speedy');
    expect(plan.row.status).toBe('working');
    expect(plan.row.model).toBe('local');
  });

  it('criterion 3: a snapshot leaves omitted default and registered rows, and updates status only', () => {
    const speedy = row({
      id: 'speedy',
      name: 'Speedy',
      source: 'default',
      position: 0,
      role: 'chief of staff',
      color: '#8d5bff',
    });
    const helper = row({
      id: 'forge_helper',
      name: 'Forge Helper',
      source: 'registered',
      position: 12,
      role: 'engineer',
      color: '#9bd434',
      emoji: '🔧',
      status: 'idle',
      model: 'local',
      avatar: 'kept',
    });
    const oldSnap = row({
      id: 'old_snap',
      name: 'Old Snap',
      source: 'snapshot',
      position: 4,
    });
    const incoming = normalizeSnapshotAgents({
      agents: [
        {
          id: 'forge_helper',
          name: 'Renamed',
          role: 'other',
          color: '#000000',
          status: 'working',
          currentTask: 'Shipping',
          emoji: '👻',
        },
        { id: 'nova', name: 'Nova', role: 'development', status: 'idle' },
      ],
    });
    const plan = planSnapshot([speedy, helper, oldSnap], incoming);
    expect(plan.deleteIds).toEqual(['old_snap']);
    expect(plan.creates.map((agent) => agent.id)).toEqual(['nova']);
    expect(plan.creates[0].source).toBe('snapshot');
    expect(plan.snapshotWrites).toEqual([]);
    expect(plan.statusWrites).toEqual([
      {
        id: 'forge_helper',
        data: { status: 'working', currentTask: 'Shipping' },
      },
    ]);
    const omitted = planSnapshot([speedy, helper], []);
    expect(omitted.deleteIds).toEqual([]);
    expect(omitted.creates).toEqual([]);
    expect(omitted.statusWrites).toEqual([]);
  });

  it('matches by id only and does not move a default parent', () => {
    const scout = row({
      id: 'scout',
      name: 'Scout',
      source: 'default',
      parentId: 'speedy',
      status: 'working',
      position: 11,
    });
    const sentinel = row({
      id: 'sentinel',
      name: 'Sentinel',
      source: 'default',
      parentId: 'speedy',
      status: 'working',
      position: 3,
    });
    const qa = row({
      id: 'qa_bot',
      name: 'QA Bot',
      source: 'registered',
      parentId: 'speedy',
      status: 'idle',
      position: 12,
    });
    const forge = row({
      id: 'forge',
      name: 'Forge',
      source: 'default',
      parentId: 'speedy',
      position: 2,
    });

    const named = normalizeSnapshotAgents({
      agents: [{ name: 'Sentinel', parent: 'Forge' }],
    });
    expect(named[0].id).toBe('sentinel');
    const namedPlan = planSnapshot([sentinel, forge], named);
    expect(namedPlan.creates).toEqual([]);
    expect(namedPlan.parentLinks).toEqual([]);
    expect(namedPlan.statusWrites).toEqual([]);

    const clone = normalizeSnapshotAgents({
      agents: [
        {
          id: 'scout_clone',
          name: 'Scout',
          status: 'hijacked',
          parent: 'Forge',
        },
      ],
    });
    const clonePlan = planSnapshot([scout, forge], clone);
    expect(clonePlan.creates.map((agent) => agent.id)).toEqual(['scout_clone']);
    expect(clonePlan.creates[0]).toMatchObject({
      name: 'Scout',
      source: 'snapshot',
      status: 'hijacked',
    });
    expect(clonePlan.parentLinks).toEqual([
      { id: 'scout_clone', parentId: 'forge' },
    ]);
    expect(clonePlan.statusWrites).toEqual([]);
    expect(clonePlan.parentLinks.map((link) => link.id)).not.toContain('scout');

    const other = normalizeSnapshotAgents({
      agents: [{ id: 'other_thing', name: 'QA Bot', status: 'stolen' }],
    });
    const otherPlan = planSnapshot([qa], other);
    expect(otherPlan.creates.map((agent) => agent.id)).toEqual(['other_thing']);
    expect(otherPlan.statusWrites).toEqual([]);
    expect(otherPlan.parentLinks.map((link) => link.id)).not.toContain(
      'qa_bot',
    );
  });

  it('seed:demo puts Pixel under Speedy', () => {
    const text = readFileSync(
      join(__dirname, '../../scripts/seed-demo.ts'),
      'utf8',
    );
    expect(text).toContain("const LEAD = 'Speedy'");
    const pixel = text.slice(text.indexOf("name: 'Pixel'"));
    expect(pixel.slice(0, 220)).toContain('parent: LEAD');
    expect(text).toContain("source: 'default'");
    expect(text).toContain('parentId: parent.id');
  });

  it('criterion 4: heartbeat stamps lastSeenAt and 10 minutes reads offline', () => {
    const bot = row({
      id: 'forge_helper',
      name: 'Forge Helper',
      source: 'registered',
      lastSeenAt: now,
    });
    const beat = planHeartbeat(bot, now);
    expect(beat.ok).toBe(true);
    if (!beat.ok) return;
    expect(beat.row.lastSeenAt).toEqual(now);
    expect(isOnline('registered', now, now)).toBe(true);
    const later = new Date(now.getTime() + offlineAfterMs());
    expect(isOnline('registered', now, later)).toBe(false);
    const almost = new Date(now.getTime() + offlineAfterMs() - 1);
    expect(isOnline('registered', now, almost)).toBe(true);
    expect(isOnline('default', null, later)).toBe(true);
    const patched = planHeartbeat(bot, now, {
      status: 'working',
      currentTask: 'Shipping the notes',
    });
    expect(patched.ok).toBe(true);
    if (patched.ok) {
      expect(patched.row.status).toBe('working');
      expect(patched.row.currentTask).toBe('Shipping the notes');
      expect(patched.row.lastSeenAt).toEqual(now);
      expect(patched.row.name).toBe(bot.name);
    }
    const untouched = planHeartbeat(bot, now, {});
    expect(untouched.ok).toBe(true);
    if (untouched.ok) {
      expect(untouched.row.status).toBe(bot.status);
      expect(untouched.row.currentTask).toBe(bot.currentTask);
    }
    const busy = row({
      ...bot,
      status: 'working',
      currentTask: 'Shipping the notes',
    });
    const idle = planHeartbeat(busy, now, { status: 'idle' });
    expect(idle.ok && idle.row.currentTask).toBe(null);
    expect(idle.ok && idle.row.status).toBe('idle');
    const idleKeepsNone = planHeartbeat(busy, now, {
      status: 'idle',
      currentTask: 'Still writing',
    });
    expect(idleKeepsNone.ok && idleKeepsNone.row.currentTask).toBe(null);
    const cleared = planHeartbeat(busy, now, { currentTask: null });
    expect(cleared.ok && cleared.row.currentTask).toBe(null);
    expect(cleared.ok && cleared.row.status).toBe('idle');
    const blank = planHeartbeat(busy, now, { currentTask: '' });
    expect(blank.ok && blank.row.currentTask).toBe(null);
    expect(blank.ok && blank.row.status).toBe('idle');
    const spaces = planHeartbeat(busy, now, { currentTask: '   ' });
    expect(spaces.ok && spaces.row.currentTask).toBe(null);
    expect(spaces.ok && spaces.row.status).toBe('idle');
    const clearWins = planHeartbeat(busy, now, {
      status: 'working',
      currentTask: null,
    });
    expect(clearWins.ok && clearWins.row.currentTask).toBe(null);
    expect(clearWins.ok && clearWins.row.status).toBe('idle');
    expect(planHeartbeat(null, now)).toEqual({
      ok: false,
      status: 404,
      message: 'agent not found',
    });
    expect(
      planHeartbeat(
        row({ id: 'speedy', name: 'Speedy', source: 'default' }),
        now,
      ).ok,
    ).toBe(false);
  });

  it('criterion 5: delete allows a registered row and refuses a default', () => {
    expect(
      planDelete(
        row({ id: 'forge_helper', name: 'Forge Helper', source: 'registered' }),
      ),
    ).toEqual({ ok: true });
    expect(
      planDelete(row({ id: 'speedy', name: 'Speedy', source: 'default' })),
    ).toEqual({
      ok: false,
      status: 409,
      message: 'default agents cannot be deleted',
    });
    expect(
      planDelete(row({ id: 'nova', name: 'Nova', source: 'snapshot' })),
    ).toEqual({
      ok: false,
      status: 409,
      message: 'snapshot agents cannot be deleted',
    });
    expect(planDelete(null)).toEqual({
      ok: false,
      status: 404,
      message: 'agent not found',
    });
  });

  it('criterion 8: uuid ids backfill to snapshot and other ids to default', () => {
    expect(backfillSource('11111111-2222-4333-8444-555555555555')).toBe(
      'snapshot',
    );
    expect(backfillSource('ckn5defaultagent')).toBe('default');
    expect(backfillSource('speedy')).toBe('default');
    expect(slugFromName('Speedy')).toBe('speedy');
    expect(slugFromName('Demo Lead')).toBe('demo_lead');

    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261012120000_agent_source/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain(SNAPSHOT_ID.source);
    expect(sql).toContain(`SET "source" = 'snapshot'`);
    expect(sql).toContain(`DEFAULT 'default'`);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DELETE FROM "Agent"/i);
    expect(NAME_MAX).toBe(200);
  });
});
