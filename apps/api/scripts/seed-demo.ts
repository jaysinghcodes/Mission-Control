/**
 * seed-demo.ts — `npm run seed:demo` (ticket 2).
 *
 * Fills a fresh Mission Control database with SAMPLE data so a machine with
 * no OpenClaw still gets a clickable Board (/tickets), Calendar, Team, Office
 * and Activity feed:
 *   - 8 agents (one lead on top, seven sub-agents below — generic names)
 *   - 6 cron jobs (timed, weekly, and interval — exercises every Calendar lane)
 *   - 8 tickets spread across To-Do / Build / QA / Review / Done + 2 backlog
 *   - 3 projects (Onboarding 1 of 2 done, Pipeline 0 of 3, Ideas empty)
 *   - 10 activity events (run.* + approvals) so Activity/Office have history
 *   - 1 pending approval (matches the `approval.new` activity event)
 *
 * IDEMPOTENT — safe to run any number of times:
 *   - Every row has a FIXED id (prefix `demo-`) or a unique natural key
 *     (Agent.name), and is written with `upsert(…, update: {})`. Re-running
 *     creates only what is missing and never duplicates.
 *   - `update: {}` is deliberate: if you clicked around (moved a demo ticket to
 *     Done), a re-seed does NOT undo your changes.
 *   - Nothing is ever deleted. Real (non-demo) rows are never touched.
 *
 * Ticket 4 added the Project table and Ticket.projectId. This script writes
 * those columns; it does not migrate. If the table is missing, the run fails
 * with a pointer at `prisma migrate deploy` (the api container does that on
 * boot). Demo activity is tagged `source: 'demo'` (existing column, default
 * 'openclaw') so it is distinguishable from real bridge traffic.
 *
 * Interaction with the bridge: once a real OpenClaw bridge posts
 * agents/calendar snapshots, those REPLACE the Agent / CronJob tables (that's
 * the snapshot contract) — i.e. real data supersedes demo agents/jobs
 * automatically. Demo tickets/activity remain until you delete them
 * (`DELETE … WHERE id LIKE 'demo-%'`).
 *
 * Runs on the HOST against the compose Postgres (127.0.0.1:5432) using
 * DATABASE_URL from the env or the repo-root .env, same as the api.
 * SECURITY: refuses NODE_ENV=production unless SEED_DEMO_ALLOW_PROD=1 —
 * demo rows should never silently land in a real instance.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
// Single source of truth for valid ticket statuses (ticket 1). Imported so a
// typo or a future status rename fails the seed loudly instead of creating
// cards that vanish from every column.
import { isTicketStatus, TICKET_STATUSES } from '../src/tickets/ticket-status';
import {
  DEMO_PROJECTS,
  assertDemoSeedProjects,
  demoProjectIdForTicket,
} from '../src/projects/demo-catalog';
import { projectNameKey } from '../src/projects/project-name';

/** Load KEY=VALUE pairs from a .env file without overriding the real env. */
function loadDotenv(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.endsWith(val[0])) {
      val = val.slice(1, -1);
    }
    // Empty values in .env (e.g. `DATABASE_URL=`) must not mask the fallback.
    if (key && val && process.env[key] === undefined) process.env[key] = val;
  }
}

// scripts/ → apps/api → repo root. apps/api/.env first (api-local wins), then root.
loadDotenv(join(__dirname, '..', '.env'));
loadDotenv(join(__dirname, '..', '..', '..', '.env'));

if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_ALLOW_PROD !== '1') {
  console.error('[seed:demo] NODE_ENV=production — refusing to write demo data (set SEED_DEMO_ALLOW_PROD=1 to override).');
  process.exit(2);
}

// Same default as PrismaService / prisma.config.ts (local dev + compose port).
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/mission_control';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// ── Sample data ─────────────────────────────────────────────────────────────
// NAMES ARE DELIBERATELY GENERIC ("Demo …") so screenshots and first runs
// show obviously-sample data. Demo agents carry no `channel`, and since
// ticket 3 the web app has no hardcoded chat-server fallback, so
// channelHref() returns null and the profile drawer simply hides the link.
//
// ROLES, on the other hand, intentionally reuse the roster lane keys
// (development, qa, research, …) so that:
//   - Team cards get a proper role title + robot avatar (matched by role),
//   - Office places working agents at the right station (dev→Build, qa→QA).
// Because the names are not "generic placeholders" in roster.ts terms
// (main/subagent/agent…), the cards keep showing our "Demo …" names.
//
// `working` agents stand at their station in the Office; `idle` ones sit in
// the Break Room. `parent` is a NAME, wired to an id in phase 2 below.
const LEAD = 'Demo Lead';
const AGENTS = [
  { name: LEAD, role: 'chief of staff', color: '#A371F7', status: 'working', parent: null, emoji: '🧭', currentTask: 'Triage the morning queue', tasksCompleted: 42, totalCost: 3.18, tags: ['strategist', 'daily', 'integrator'] },
  { name: 'Demo Planner', role: 'scrum master', color: '#D29922', status: 'idle', parent: LEAD, emoji: '🗺️', currentTask: null, tasksCompleted: 17, totalCost: 0.64, tags: ['planner', 'cadence'] },
  { name: 'Demo Builder', role: 'development', color: '#3FB950', status: 'working', parent: LEAD, emoji: '🛠️', currentTask: 'DEMO-3 · Wire calendar week view', tasksCompleted: 31, totalCost: 2.41, tags: ['builder', 'typescript'] },
  { name: 'Demo Tester', role: 'qa', color: '#39C5CF', status: 'working', parent: LEAD, emoji: '🧪', currentTask: 'DEMO-4 · Regression pass on Tickets', tasksCompleted: 23, totalCost: 0.97, tags: ['tester', 'skeptic'] },
  { name: 'Demo Researcher', role: 'research', color: '#58A6FF', status: 'idle', parent: LEAD, emoji: '📚', currentTask: null, tasksCompleted: 12, totalCost: 1.12, tags: ['curious', 'sources'] },
  { name: 'Demo Designer', role: 'design', color: '#F78166', status: 'idle', parent: LEAD, emoji: '🎨', currentTask: null, tasksCompleted: 9, totalCost: 0.38, tags: ['visual', 'tokens'] },
  { name: 'Demo Writer', role: 'summary', color: '#A371F7', status: 'idle', parent: LEAD, emoji: '✍️', currentTask: null, tasksCompleted: 28, totalCost: 0.55, tags: ['concise'] },
  { name: 'Demo Monitor', role: 'alerts', color: '#D29922', status: 'idle', parent: LEAD, emoji: '🛡️', currentTask: null, tasksCompleted: 54, totalCost: 0.21, tags: ['watchful', 'on-call'] },
];

// Calendar.tsx: day 0=Mon … 6=Sun, day=null repeats daily; time=null → all-day strip.
const CRON_JOBS = [
  { id: 'demo-cron-morning-brief', name: 'Morning Brief', schedule: '0 7 * * *', day: null, time: '07:00' },
  { id: 'demo-cron-trend-radar', name: 'Trend Radar', schedule: '0 12 * * *', day: null, time: '12:00' },
  { id: 'demo-cron-weekly-review', name: 'Weekly Review', schedule: '30 16 * * 5', day: 4, time: '16:30' },
  { id: 'demo-cron-backlog-groom', name: 'Backlog Groom', schedule: '0 10 * * 1', day: 0, time: '10:00' },
  { id: 'demo-cron-security-scan', name: 'Security Scan', schedule: '0 2 * * 0', day: 6, time: '02:00' },
  { id: 'demo-cron-inbox-poll', name: 'Inbox Poll', schedule: 'every 5m', day: null, time: null },
];

// Statuses are the kanban columns in Tickets.tsx (todo/build/qa/review/done) + backlog.
const TICKETS = [
  { id: 'demo-ticket-1', key: 'DEMO-1', title: 'Draft onboarding checklist', status: 'todo', priority: 'med', assignee: 'Demo Planner', tags: ['docs'], points: 2 },
  { id: 'demo-ticket-2', key: 'DEMO-2', title: 'Add dark-mode screenshots', status: 'todo', priority: 'low', assignee: 'Demo Designer', tags: ['design'], points: 1 },
  { id: 'demo-ticket-3', key: 'DEMO-3', title: 'Wire calendar week view', status: 'build', priority: 'high', assignee: 'Demo Builder', tags: ['web'], points: 5 },
  { id: 'demo-ticket-4', key: 'DEMO-4', title: 'Regression pass on Tickets', status: 'qa', priority: 'high', assignee: 'Demo Tester', tags: ['qa'], points: 3 },
  { id: 'demo-ticket-5', key: 'DEMO-5', title: 'Summarize weekly activity', status: 'review', priority: 'med', assignee: 'Demo Writer', tags: ['summary'], points: 2 },
  { id: 'demo-ticket-6', key: 'DEMO-6', title: 'Rotate demo ingest token', status: 'done', priority: 'med', assignee: 'Demo Monitor', tags: ['ops'], points: 1 },
  { id: 'demo-ticket-7', key: 'DEMO-7', title: 'Research provider pricing', status: 'backlog', priority: 'low', assignee: 'Demo Researcher', tags: ['research'], points: 3 },
  { id: 'demo-ticket-8', key: 'DEMO-8', title: 'Office floor ambient animations', status: 'backlog', priority: 'low', assignee: 'Demo Designer', tags: ['design'], points: 2 },
];

// Activity: `minsAgo` gives a believable spread on first insert. Types are
// from the ingest KNOWN_TYPES union so pages color them like real events.
const ACTIVITY = [
  { id: 'demo-act-01', minsAgo: 95, type: 'run.started', payload: { name: 'Morning Brief', agent: LEAD } },
  { id: 'demo-act-02', minsAgo: 92, type: 'run.completed', payload: { name: 'Morning Brief', agent: LEAD, status: 'done' } },
  { id: 'demo-act-03', minsAgo: 70, type: 'run.queued', payload: { name: 'ticket DEMO-3', ticket: 'DEMO-3' } },
  { id: 'demo-act-04', minsAgo: 64, type: 'run.running', payload: { name: 'ticket DEMO-3', ticket: 'DEMO-3', agent: 'Demo Builder' } },
  { id: 'demo-act-05', minsAgo: 51, type: 'run.progress', payload: { name: 'ticket DEMO-3', agent: 'Demo Builder', progress: 60 } },
  { id: 'demo-act-06', minsAgo: 40, type: 'run.running', payload: { name: 'ticket DEMO-4', ticket: 'DEMO-4', agent: 'Demo Tester' } },
  { id: 'demo-act-07', minsAgo: 33, type: 'run.failed', payload: { name: 'Trend Radar', agent: 'Demo Researcher', status: 'failed', summary: 'demo: upstream timeout' } },
  { id: 'demo-act-08', minsAgo: 21, type: 'approval.new', payload: { name: 'Deploy preview', kind: 'exec' } },
  { id: 'demo-act-09', minsAgo: 12, type: 'run.done', payload: { name: 'ticket DEMO-6', ticket: 'DEMO-6', agent: 'Demo Monitor' } },
  { id: 'demo-act-10', minsAgo: 4, type: 'run.completed', payload: { name: 'Inbox Poll', agent: 'Demo Monitor', status: 'done' } },
];

// One pending approval so the Approvals page (and the `approval.new` event
// above) has something to click. Fixed id → idempotent like everything else.
// Note: a later real `approvals.snapshot` from the bridge drops all PENDING
// rows (snapshot contract), which is exactly what we want for demo data.
const APPROVALS = [
  { id: 'demo-approval-1', kind: 'exec', tag: 'Deploy preview', desc: 'Demo: allow the preview deploy script to run', status: 'pending' },
];

async function main(): Promise<void> {
  // Statuses are written EXPLICITLY (we bypass POST /tickets, whose default
  // for an omitted status is `backlog`), so validate them up front.
  const bad = TICKETS.filter((t) => !isTicketStatus(t.status));
  if (bad.length > 0) {
    throw new Error(
      `invalid demo ticket status: ${bad.map((t) => `${t.key}=${t.status}`).join(', ')} — expected one of ${TICKET_STATUSES.join(', ')}`,
    );
  }

  // Throws if the ticket list no longer produces Onboarding "1 of 2",
  // Pipeline "0 of 3", and an empty Ideas project. See demo-catalog.ts.
  assertDemoSeedProjects(TICKETS);

  const counts = { agents: 0, cronJobs: 0, tickets: 0, projects: 0, activity: 0, approvals: 0 };

  // Projects BEFORE tickets: Ticket.projectId is a foreign key. Fixed ids
  // plus `update: {}` — a re-run does not rename or un-archive a project
  // you already edited, and it does not insert a second copy.
  for (const p of DEMO_PROJECTS) {
    const before = await prisma.project.findUnique({ where: { id: p.id }, select: { id: true } });
    await prisma.project.upsert({
      where: { id: p.id },
      update: {},
      create: { id: p.id, name: p.name, nameKey: projectNameKey(p.name) },
    });
    if (!before) counts.projects++;
  }

  // Agents — phase 1: upsert by unique name (no parent yet → FK-safe in any order).
  for (const a of AGENTS) {
    const before = await prisma.agent.findUnique({ where: { name: a.name }, select: { id: true } });
    await prisma.agent.upsert({
      where: { name: a.name },
      update: {}, // never clobber an existing (possibly bridge-pushed) agent
      create: {
        name: a.name,
        role: a.role,
        color: a.color,
        status: a.status,
        emoji: a.emoji,
        currentTask: a.currentTask,
        tasksCompleted: a.tasksCompleted,
        totalCost: a.totalCost,
        personalityTags: a.tags,
        recentActivity: a.currentTask ? `Working on ${a.currentTask}` : 'Idle in the Break Room',
      },
    });
    if (!before) counts.agents++;
  }
  // Agents — phase 2: wire the tree only where no parent is set yet.
  for (const a of AGENTS.filter((x) => x.parent)) {
    const parent = await prisma.agent.findUnique({ where: { name: a.parent! }, select: { id: true } });
    if (parent) {
      await prisma.agent.updateMany({ where: { name: a.name, parentId: null }, data: { parentId: parent.id } });
    }
  }

  for (const j of CRON_JOBS) {
    const before = await prisma.cronJob.findUnique({ where: { id: j.id }, select: { id: true } });
    await prisma.cronJob.upsert({ where: { id: j.id }, update: {}, create: { ...j, enabled: true } });
    if (!before) counts.cronJobs++;
  }

  for (const t of TICKETS) {
    const before = await prisma.ticket.findUnique({ where: { id: t.id }, select: { id: true } });
    // projectId is part of `create` only. A ticket that already exists keeps
    // whatever project you assigned (or cleared) — same rule as status.
    // Fresh databases get the sample links; a second run inserts nothing.
    await prisma.ticket.upsert({
      where: { id: t.id },
      update: {},
      create: { ...t, projectId: demoProjectIdForTicket(t.id) },
    });
    if (!before) counts.tickets++;
  }

  const now = Date.now();
  for (const e of ACTIVITY) {
    const before = await prisma.activityEvent.findUnique({ where: { id: e.id }, select: { id: true } });
    await prisma.activityEvent.upsert({
      where: { id: e.id },
      update: {},
      create: { id: e.id, type: e.type, payload: e.payload, source: 'demo', ts: new Date(now - e.minsAgo * 60_000) },
    });
    if (!before) counts.activity++;
  }

  for (const a of APPROVALS) {
    const before = await prisma.approval.findUnique({ where: { id: a.id }, select: { id: true } });
    await prisma.approval.upsert({ where: { id: a.id }, update: {}, create: a });
    if (!before) counts.approvals++;
  }

  // What THIS run inserted (0 everywhere on a re-run = already seeded).
  console.log(
    `[seed:demo] inserted agents=${counts.agents} cronJobs=${counts.cronJobs} projects=${counts.projects} tickets=${counts.tickets} ` +
      `activity=${counts.activity} approvals=${counts.approvals} (0 everywhere = already seeded; re-running is safe)`,
  );

  // Table totals AFTER the run — the idempotency check is simply "these
  // numbers do not change when you run seed:demo a second time" (as long as
  // nothing else, e.g. a running api/bridge, writes in between).
  const [agents, cronJobs, projects, tickets, activity, approvals] = await Promise.all([
    prisma.agent.count(),
    prisma.cronJob.count(),
    prisma.project.count(),
    prisma.ticket.count(),
    prisma.activityEvent.count(),
    prisma.approval.count(),
  ]);
  console.log(
    `[seed:demo] totals agents=${agents} cronJobs=${cronJobs} projects=${projects} tickets=${tickets} activity=${activity} approvals=${approvals}`,
  );
}

main()
  .catch((err) => {
    console.error('[seed:demo] failed:', err instanceof Error ? err.message : err);
    // Prisma P2021 = "table does not exist": the db is up but unmigrated. The
    // api container runs `prisma migrate deploy` on boot; without it (db-only
    // compose / manual Postgres) the schema has to be applied by hand. We do
    // NOT auto-migrate here — schema changes stay an explicit, reviewed step.
    if ((err as { code?: string })?.code === 'P2021') {
      console.error('[seed:demo] Schema missing — start the api once, or run `cd apps/api && npx prisma migrate deploy`.');
    } else {
      // Most common cause on a fresh clone: compose db not up yet.
      console.error('[seed:demo] Is Postgres up? `docker compose up -d db` (or the full stack) and check DATABASE_URL.');
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
