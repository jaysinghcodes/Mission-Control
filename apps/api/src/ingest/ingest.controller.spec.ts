import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * IngestController e2e-style tests (supertest against the real module).
 *
 * Scope: auth guard + event validation on POST /events. Broadcast behavior
 * itself is covered by the gateway spec; here we prove the door is locked
 * in production and rejects unknown types.
 */
describe('IngestController (POST /events)', () => {
  let app: INestApplication;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    // A root .env copied from .env.example sets INGEST_TOKEN. Auth runs
    // before type checks, so that value would turn "unknown type" into 401.
    // Each test sets the token itself when it wants one. afterEach restores it.
    delete process.env.INGEST_TOKEN;
    jest.resetModules();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    process.env = { ...savedEnv };
    await app.close();
  });

  it('rejects unknown event types', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .send({ type: 'not.a.real.event' });
    expect(res.status).toBe(400);
  });

  it('accepts a known event type in dev (no token required when INGEST_TOKEN unset)', async () => {
    delete process.env.INGEST_TOKEN;
    process.env.NODE_ENV = 'development';
    const res = await request(app.getHttpServer())
      .post('/events')
      .send({ type: 'run.started', payload: { name: 'Morning Brief' } });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
  });

  it('fails closed in production without a token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.INGEST_TOKEN = 'secret';
    const res = await request(app.getHttpServer())
      .post('/events')
      .send({ type: 'run.started' });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.INGEST_TOKEN = 'secret';
    const res = await request(app.getHttpServer())
      .post('/events')
      .set('x-ingest-token', 'secret')
      .send({ type: 'health.tick' });
    expect(res.status).toBe(202);
  });
});

/**
 * MC-200 — agent snapshot profile fields + roster endpoints.
 *
 * Covers the three acceptance cases: (1) a snapshot WITH the new fields
 * persists them, (2) a legacy snapshot WITHOUT them falls back to
 * defaults/null (backward compatible), and (3) GET /agents/:id returns one
 * agent with its children (parentId tree). These tests run against the real
 * module + dev DB like the rest of this file; the roster present before the
 * tests is restored in afterAll so the dashboard isn't left showing test
 * agents after the suite runs.
 */
describe('MC-200 agent snapshot profile fields (POST /events agents.snapshot)', () => {
  let app: INestApplication;
  const savedEnv = { ...process.env };
  let originalRoster: {
    name: string;
    color: string;
    role: string | null;
    status: string;
    parent: string | null;
  }[] = [];

  const seedSnapshot = (agents: unknown[]) =>
    request(app.getHttpServer())
      .post('/events')
      .send({ type: 'agents.snapshot', payload: { agents } });

  beforeAll(async () => {
    jest.resetModules();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    // Dev posture: token-less pushes allowed (same convention as the tests above).
    delete process.env.INGEST_TOKEN;
    process.env.NODE_ENV = 'development';

    // Preserve the live roster so it can be restored once the suite finishes.
    // (A bridge push may land mid-suite — that's fine, the last write wins and
    // the restore below re-asserts the pre-test roster.)
    let current: {
      id: string;
      name: string;
      color: string;
      role: string | null;
      status: string;
      parentId: string | null;
    }[] = [];
    for (let attempt = 0; attempt < 5 && current.length === 0; attempt++) {
      const res = await request(app.getHttpServer()).get('/agents');
      current =
        res.status === 200 && Array.isArray(res.body?.agents)
          ? res.body.agents
          : [];
      if (current.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    const idToName = new Map<string, string>(
      current.map((a) => [a.id, a.name]),
    );
    originalRoster = current.map((a) => ({
      name: a.name,
      color: a.color,
      role: a.role,
      status: a.status,
      parent: a.parentId ? (idToName.get(a.parentId) ?? null) : null,
    }));
  });

  afterAll(async () => {
    // Restore the roster that existed before the suite ran.
    const res = await seedSnapshot(originalRoster);
    if (res.status !== 202) {
      console.warn(
        `[ingest.spec] roster restore failed (${res.status}):`,
        res.body,
      );
    }
    process.env = { ...savedEnv };
    await app.close();
  });

  it('persists the new profile fields when a snapshot includes them', async () => {
    const res = await seedSnapshot([
      {
        name: 'Nova',
        color: '#4DD0E1',
        role: 'development',
        status: 'working',
        emoji: '🔧',
        personalityTags: ['builder', 'daily'],
        currentTask: 'MC-200 agent data model',
        tasksCompleted: 42,
        totalCost: 12.4,
        recentActivity: 'merged PR #11',
        channel: '#development',
      },
    ]);
    expect(res.status).toBe(202);

    const list = await request(app.getHttpServer()).get('/agents');
    expect(list.status).toBe(200);
    const nova = list.body.agents.find(
      (a: { name: string }) => a.name === 'Nova',
    );
    expect(nova).toBeTruthy();
    expect(nova).toMatchObject({
      emoji: '🔧',
      personalityTags: ['builder', 'daily'],
      currentTask: 'MC-200 agent data model',
      tasksCompleted: 42,
      totalCost: 12.4,
      recentActivity: 'merged PR #11',
      channel: '#development',
    });
  });

  it('falls back to defaults/null when a snapshot omits the new fields (legacy, backward compatible)', async () => {
    const res = await seedSnapshot([
      { name: 'LegacyBot', color: '#888888', role: 'qa', status: 'idle' },
    ]);
    expect(res.status).toBe(202);

    const list = await request(app.getHttpServer()).get('/agents');
    const legacy = list.body.agents.find(
      (a: { name: string }) => a.name === 'LegacyBot',
    );
    expect(legacy).toBeTruthy();
    // Legacy fields intact…
    expect(legacy).toMatchObject({
      name: 'LegacyBot',
      color: '#888888',
      role: 'qa',
      status: 'idle',
    });
    // …new fields all at schema defaults / null.
    expect(legacy).toMatchObject({
      emoji: null,
      personalityTags: null,
      currentTask: null,
      tasksCompleted: 0,
      totalCost: 0,
      recentActivity: null,
      channel: null,
    });
  });

  it('GET /agents/:id returns one agent with its children (parentId relation)', async () => {
    const res = await seedSnapshot([
      {
        name: 'Demo Lead',
        role: 'chief-of-staff',
        status: 'working',
        emoji: '🧑\u200d💼',
      },
      {
        name: 'Nova',
        role: 'development',
        status: 'working',
        parent: 'Demo Lead',
      },
      { name: 'Pixel', role: 'design', status: 'idle', parent: 'Demo Lead' },
    ]);
    expect(res.status).toBe(202);

    // Lookup by stable name (ids rotate every snapshot) — returns the agent + children.
    const byName = await request(app.getHttpServer()).get(
      '/agents/Demo%20Lead',
    );
    expect(byName.status).toBe(200);
    expect(byName.body.agent.name).toBe('Demo Lead');
    const childNames = byName.body.agent.children
      .map((c: { name: string }) => c.name)
      .sort();
    expect(childNames).toEqual(['Nova', 'Pixel']);

    // Lookup by raw id works too, and a leaf agent has no children.
    const list = await request(app.getHttpServer()).get('/agents');
    const nova = list.body.agents.find(
      (a: { name: string }) => a.name === 'Nova',
    );
    const byId = await request(app.getHttpServer()).get(`/agents/${nova.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.agent.name).toBe('Nova');
    expect(byId.body.agent.children).toEqual([]);

    // Unknown agent → 404.
    const missing = await request(app.getHttpServer()).get(
      '/agents/NoSuchAgent',
    );
    expect(missing.status).toBe(404);
  });

  it('accepts out-of-order snapshots (children listed before their parent) without FK errors', async () => {
    // Regression guard: applyAgents must not depend on producers ordering
    // parents first (GET /agents returns children first — re-ingesting that
    // order used to violate Agent_parentId_fkey).
    const res = await seedSnapshot([
      { name: 'Pixel', role: 'design', status: 'idle', parent: 'Demo Lead' },
      {
        name: 'Nova',
        role: 'development',
        status: 'working',
        parent: 'Demo Lead',
      },
      { name: 'Demo Lead', role: 'chief-of-staff', status: 'working' },
    ]);
    expect(res.status).toBe(202);

    const byName = await request(app.getHttpServer()).get(
      '/agents/Demo%20Lead',
    );
    expect(byName.status).toBe(200);
    const childNames = byName.body.agent.children
      .map((c: { name: string }) => c.name)
      .sort();
    expect(childNames).toEqual(['Nova', 'Pixel']);
  });
});
