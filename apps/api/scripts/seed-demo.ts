/**
 * seed-demo.ts — `npm run seed:demo` (ticket 2).
 *
 * Fills a fresh Mission Control database with SAMPLE data so a machine with
 * no OpenClaw still gets a clickable Board (/tickets), Calendar, Team, Office
 * and Activity feed:
 *   - 12 agents (cool name · function: Speedy, Forge, Aegis, …)
 *   - 6 cron jobs (timed, weekly, and interval — exercises every Calendar lane)
 *   - 8 tickets spread across To-Do / Build / QA / Review / Done + 2 backlog
 *   - 3 projects (Onboarding 1 of 2 done, Pipeline 0 of 3, Ideas empty)
 *   - 10 activity events (run.* + approvals) so Activity/Office have history
 *   - 1 pending approval (matches the `approval.new` activity event)
 *   - sample memories across several America/Chicago days (ticket 5)
 *   - sample markdown docs in DOCS_ROOT (ticket 6; default <repo>/data/docs)
 *   - a sample mission statement and 3 devices (ticket 7)
 *   - 1 experimental custom tool (ticket 10; a prompt template only — the
 *     seed does not run it, and a test run never calls out of the app)
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
import { buildDemoMemories } from '../src/memory/demo-memories';
import { writeDemoDocs } from '../src/docs/demo-docs';
import { configuredDocsRoot } from '../src/docs/docs-path';
import { DEMO_DEVICES, DEMO_MISSION } from '../src/team/demo-team';
import { SETTING_ID } from '../src/team/mission';

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
// Ticket 13: cool name · function, matching roster.ts and the 12 robots.
// Roles are the lane keys robotAssign already understands, so each agent
// wears the matching robot. Names are not generic placeholders, so the
// cards show Speedy / Forge / Aegis rather than a mapped alias.
// Demo agents carry no `channel` (ticket 3 — no hardcoded chat server).
//
// LEGACY_AGENT_NAMES renames a previous seed ("Demo Builder" → Forge) when
// the new name is free. Nothing is deleted: if both rows exist, both stay.
const LEGACY_AGENT_NAMES: Record<string, string> = {
  'Demo Lead': 'Speedy',
  'Demo Planner': 'Atlas',
  'Demo Builder': 'Forge',
  'Demo Tester': 'Sentinel',
  'Demo Researcher': 'Echo',
  'Demo Designer': 'Pixel',
  'Demo Writer': 'Quill',
  'Demo Monitor': 'Aegis',
};

const LEAD = 'Speedy';
// Task lines are the locked office floor (design-refs/ticket-9): a short
// status under each desk, and Speedy's line is the Commons table caption.
const AGENTS = [
  { name: LEAD, role: 'chief of staff', color: '#8d5bff', status: 'working', parent: null, emoji: null, currentTask: 'Planning ticket 5', tasksCompleted: 42, totalCost: 3.18, tags: ['strategist', 'daily'] },
  { name: 'Atlas', role: 'product', color: '#ffc531', status: 'idle', parent: LEAD, emoji: null, currentTask: 'Spec locked', tasksCompleted: 17, totalCost: 0.64, tags: ['planner'] },
  { name: 'Forge', role: 'engineer', color: '#9bd434', status: 'working', parent: LEAD, emoji: null, currentTask: 'Ticket 4 · Projects', tasksCompleted: 31, totalCost: 2.41, tags: ['builder'] },
  { name: 'Sentinel', role: 'qa', color: '#36b3f5', status: 'working', parent: LEAD, emoji: null, currentTask: 'QA-4 on fresh clone', tasksCompleted: 23, totalCost: 0.97, tags: ['tester'] },
  { name: 'Echo', role: 'research', color: '#19c4b4', status: 'working', parent: LEAD, emoji: null, currentTask: 'Researching calendar patterns', tasksCompleted: 12, totalCost: 1.12, tags: ['curious'] },
  { name: 'Pixel', role: 'designer', color: '#ff5fa6', status: 'working', parent: LEAD, emoji: null, currentTask: 'Office mock', tasksCompleted: 9, totalCost: 0.38, tags: ['visual'] },
  { name: 'Bolt', role: 'ops', color: '#ff8a2b', status: 'idle', parent: LEAD, emoji: null, currentTask: 'Waiting on Ship', tasksCompleted: 8, totalCost: 0.2, tags: ['ops'] },
  { name: 'Ledger', role: 'data', color: '#4a6dff', status: 'idle', parent: LEAD, emoji: null, currentTask: 'Nightly sync', tasksCompleted: 6, totalCost: 0.1, tags: ['data'] },
  { name: 'Quill', role: 'writer', color: '#d257ef', status: 'working', parent: LEAD, emoji: null, currentTask: 'Release notes', tasksCompleted: 28, totalCost: 0.55, tags: ['concise'] },
  { name: 'Aegis', role: 'security', color: '#ff4f5e', status: 'working', parent: LEAD, emoji: null, currentTask: 'Needs approval', tasksCompleted: 14, totalCost: 0.44, tags: ['security'] },
  { name: 'Patch', role: 'support', color: '#2fc56f', status: 'working', parent: LEAD, emoji: null, currentTask: 'Answering setup questions', tasksCompleted: 11, totalCost: 0.12, tags: ['support'] },
  { name: 'Scout', role: 'scout', color: '#dfe5f0', status: 'working', parent: LEAD, emoji: null, currentTask: 'Checking upstream OpenClaw changes', tasksCompleted: 19, totalCost: 0.33, tags: ['trends'] },
];

// A re-seed rewrites only these exact previous demo lines, so a task you
// edited is left alone and a fresh database still inserts the lines above.
const OFFICE_TASK_FIXUPS: { name: string; from: string | null; to: string }[] = [
  { name: 'Speedy', from: 'Running the build council', to: 'Planning ticket 5' },
  { name: 'Forge', from: 'DEMO-3 · Wire calendar week view', to: 'Ticket 4 · Projects' },
  { name: 'Pixel', from: 'DEMO-2 · Dark-mode screenshots', to: 'Office mock' },
  { name: 'Sentinel', from: 'DEMO-4 · Regression pass on Tickets', to: 'QA-4 on fresh clone' },
  { name: 'Quill', from: 'DEMO-5 · Release notes', to: 'Release notes' },
  { name: 'Aegis', from: 'DEMO-4 is waiting on your approval', to: 'Needs approval' },
  { name: 'Atlas', from: null, to: 'Spec locked' },
  { name: 'Bolt', from: null, to: 'Waiting on Ship' },
  { name: 'Ledger', from: null, to: 'Nightly sync' },
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
  { id: 'demo-ticket-1', key: 'DEMO-1', title: 'Draft onboarding checklist', status: 'todo', priority: 'med', assignee: 'Atlas', tags: ['docs'], points: 2 },
  { id: 'demo-ticket-2', key: 'DEMO-2', title: 'Add dark-mode screenshots', status: 'todo', priority: 'low', assignee: 'Pixel', tags: ['design'], points: 1 },
  { id: 'demo-ticket-3', key: 'DEMO-3', title: 'Wire calendar week view', status: 'build', priority: 'high', assignee: 'Forge', tags: ['web'], points: 5 },
  { id: 'demo-ticket-4', key: 'DEMO-4', title: 'Regression pass on Tickets', status: 'qa', priority: 'high', assignee: 'Sentinel', tags: ['qa'], points: 3 },
  { id: 'demo-ticket-5', key: 'DEMO-5', title: 'Release notes for the next cut', status: 'review', priority: 'med', assignee: 'Quill', tags: ['summary'], points: 2 },
  { id: 'demo-ticket-6', key: 'DEMO-6', title: 'Rotate demo ingest token', status: 'done', priority: 'med', assignee: 'Aegis', tags: ['ops'], points: 1 },
  { id: 'demo-ticket-7', key: 'DEMO-7', title: 'Research provider pricing', status: 'backlog', priority: 'low', assignee: 'Echo', tags: ['research'], points: 3 },
  { id: 'demo-ticket-8', key: 'DEMO-8', title: 'Office floor ambient animations', status: 'backlog', priority: 'low', assignee: 'Pixel', tags: ['design'], points: 2 },
];

// Activity: `minsAgo` gives a believable spread on first insert. Types are
// from the ingest KNOWN_TYPES union so pages color them like real events.
const ACTIVITY = [
  { id: 'demo-act-01', minsAgo: 95, type: 'run.started', payload: { name: 'Morning Brief', agent: LEAD } },
  { id: 'demo-act-02', minsAgo: 92, type: 'run.completed', payload: { name: 'Morning Brief', agent: LEAD, status: 'done' } },
  { id: 'demo-act-03', minsAgo: 70, type: 'run.queued', payload: { name: 'ticket DEMO-3', ticket: 'DEMO-3' } },
  { id: 'demo-act-04', minsAgo: 64, type: 'run.running', payload: { name: 'ticket DEMO-3', ticket: 'DEMO-3', agent: 'Forge' } },
  { id: 'demo-act-05', minsAgo: 51, type: 'run.progress', payload: { name: 'ticket DEMO-3', agent: 'Forge', progress: 60 } },
  { id: 'demo-act-06', minsAgo: 40, type: 'run.running', payload: { name: 'ticket DEMO-4', ticket: 'DEMO-4', agent: 'Sentinel' } },
  { id: 'demo-act-07', minsAgo: 33, type: 'run.failed', payload: { name: 'Trend Radar', agent: 'Scout', status: 'failed', summary: 'demo: upstream timeout' } },
  { id: 'demo-act-08', minsAgo: 21, type: 'approval.new', payload: { name: 'Deploy preview DEMO-4', kind: 'exec', agent: 'Aegis', ticket: 'DEMO-4' } },
  { id: 'demo-act-09', minsAgo: 12, type: 'run.done', payload: { name: 'ticket DEMO-6', ticket: 'DEMO-6', agent: 'Aegis' } },
  { id: 'demo-act-10', minsAgo: 4, type: 'run.completed', payload: { name: 'Inbox Poll', agent: 'Patch', status: 'done' } },
];

// One pending approval so the Approvals page (and the `approval.new` event
// above) has something to click. Fixed id → idempotent like everything else.
// Note: a later real `approvals.snapshot` from the bridge drops all PENDING
// rows (snapshot contract), which is exactly what we want for demo data.
const APPROVALS = [
  { id: 'demo-approval-1', kind: 'exec', tag: 'Deploy preview build', desc: 'Aegis wants to run the preview deploy script for DEMO-4.', status: 'pending', meta: { ticketId: 'demo-ticket-4', ticketKey: 'DEMO-4', agentId: 'Aegis' } },
  { id: 'demo-approval-2', kind: 'pr', tag: 'Merge the roster update', desc: 'You approved. Sample decision so the Decided tab is not empty.', status: 'approved' },
];

// Usage snapshots for Today / This week / This month. Fixed by period.
// update: {} so a real bridge snapshot is never overwritten by a re-seed.
const USAGE = [
  {
    period: '24h',
    totalCost: 0.84,
    tokensIn: 400_000,
    tokensOut: 200_000,
    providers: [
      { name: 'zai', model: 'glm-5.2', cost: 0.53, tokensIn: 250_000, tokensOut: 110_000, agents: ['Speedy', 'Atlas', 'Quill'] },
      { name: 'deepseek', model: 'deepseek-v4-flash', cost: 0.31, tokensIn: 130_000, tokensOut: 80_000, agents: ['Forge', 'Sentinel', 'Pixel', 'Aegis'] },
      { name: 'ollama', model: 'qwen3:8b', cost: 0, tokensIn: 20_000, tokensOut: 10_000, agents: ['Ledger', 'Bolt'] },
    ],
  },
  {
    period: '7d',
    totalCost: 3.1,
    tokensIn: 2_800_000,
    tokensOut: 1_500_000,
    providers: [
      { name: 'zai', model: 'glm-5.2', cost: 2.05, tokensIn: 1_600_000, tokensOut: 800_000, agents: ['Speedy', 'Atlas', 'Quill'] },
      { name: 'deepseek', model: 'deepseek-v4-flash', cost: 1.05, tokensIn: 1_000_000, tokensOut: 600_000, agents: ['Forge', 'Sentinel', 'Pixel', 'Aegis'] },
      { name: 'ollama', model: 'qwen3:8b', cost: 0, tokensIn: 200_000, tokensOut: 100_000, agents: ['Ledger', 'Bolt'] },
    ],
  },
  {
    period: 'month',
    totalCost: 12.4,
    tokensIn: 12_000_000,
    tokensOut: 6_600_000,
    providers: [
      { name: 'zai', model: 'glm-5.2', cost: 8.3, tokensIn: 4_200_000, tokensOut: 1_900_000, agents: ['Speedy', 'Atlas', 'Quill'] },
      { name: 'deepseek', model: 'deepseek-v4-flash', cost: 4.1, tokensIn: 7_000_000, tokensOut: 4_200_000, agents: ['Forge', 'Sentinel', 'Pixel', 'Aegis'] },
      { name: 'ollama', model: 'qwen3:8b', cost: 0, tokensIn: 800_000, tokensOut: 500_000, agents: ['Ledger', 'Bolt'] },
    ],
  },
];

// ticketId is the pipeline link (QA-13). A matching title is not the link.
// startedMinAgo is distinct so Pipeline "Started" is not one seed instant
// on every moving ticket. DEMO-6 has its own finished run.
const RUNS = [
  { id: 'demo-run-1', name: 'Deploy preview build', agent: 'Aegis', status: 'needs_approval', progress: 80, ticketId: null as string | null, startedMinAgo: 40, finishedMinAgo: null as number | null },
  { id: 'demo-run-2', name: 'Wire calendar week view', agent: 'Forge', status: 'running', progress: 40, ticketId: 'demo-ticket-3', startedMinAgo: 180, finishedMinAgo: null },
  { id: 'demo-run-3', name: 'Regression pass on Tickets', agent: 'Sentinel', status: 'running', progress: 55, ticketId: 'demo-ticket-4', startedMinAgo: 75, finishedMinAgo: null },
  { id: 'demo-run-4', name: 'Release notes for the next cut', agent: 'Quill', status: 'running', progress: 90, ticketId: 'demo-ticket-5', startedMinAgo: 26, finishedMinAgo: null },
  { id: 'demo-run-5', name: 'Morning Brief', agent: 'Speedy', status: 'done', progress: 100, ticketId: null, startedMinAgo: 500, finishedMinAgo: 470 },
  { id: 'demo-run-6', name: 'Rotate demo ingest token', agent: 'Aegis', status: 'done', progress: 100, ticketId: 'demo-ticket-6', startedMinAgo: 2400, finishedMinAgo: 2200 },
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

  const docsRoot = configuredDocsRoot();
  const docCounts = await writeDemoDocs(docsRoot);
  console.log(
    `[seed:demo] docs root=${docsRoot} written=${docCounts.written} skipped=${docCounts.skipped} (skipped = already there; a re-run does not overwrite)`,
  );

  const counts = { agents: 0, cronJobs: 0, tickets: 0, projects: 0, activity: 0, approvals: 0, usage: 0, runs: 0, memories: 0, devices: 0, mission: 0, customTools: 0 };

  // Rename a previous demo roster in place when the cool name is free.
  // If both rows already exist, leave both — the seed never deletes.
  for (const [from, to] of Object.entries(LEGACY_AGENT_NAMES)) {
    const old = await prisma.agent.findUnique({ where: { name: from }, select: { id: true } });
    if (!old) continue;
    const taken = await prisma.agent.findUnique({ where: { name: to }, select: { id: true } });
    if (taken) continue;
    await prisma.agent.update({ where: { name: from }, data: { name: to } });
  }
  for (const [from, to] of Object.entries(LEGACY_AGENT_NAMES)) {
    await prisma.ticket.updateMany({
      where: { assignee: from, id: { startsWith: 'demo-' } },
      data: { assignee: to },
    });
  }

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
        recentActivity: a.currentTask
          ? a.status === 'working'
            ? `Working on ${a.currentTask}`
            : a.currentTask
          : 'Idle in the Break Room',
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
  // Office floor lines. Exact previous demo copy only — a custom currentTask
  // stays. Empty Atlas/Bolt/Ledger rows are filled only while they still
  // carry the original "Idle in the Break Room" activity from this seed.
  for (const fix of OFFICE_TASK_FIXUPS) {
    await prisma.agent.updateMany({
      where: {
        name: fix.name,
        currentTask: fix.from,
        ...(fix.from === null ? { recentActivity: 'Idle in the Break Room' } : {}),
      },
      data: { currentTask: fix.to, recentActivity: fix.to },
    });
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
  // The first seed's pending copy did not name DEMO-4, so the Tasks "Needs you"
  // flag never lit. Only rewrite that exact demo sentence.
  await prisma.approval.updateMany({
    where: { id: 'demo-approval-1', desc: 'Demo: allow the preview deploy script to run' },
    data: { tag: 'Deploy preview build', desc: 'Aegis wants to run the preview deploy script for DEMO-4.' },
  });
  // Link the demo decision to DEMO-4 by id, and to Aegis (the requester).
  // Status is left alone (a decision already taken stays decided). Prose in
  // `desc` is not the link. Ticket assignee Sentinel stays the fallback only
  // when agentId is absent.
  await prisma.approval.updateMany({
    where: { id: 'demo-approval-1' },
    data: { meta: { ticketId: 'demo-ticket-4', ticketKey: 'DEMO-4', agentId: 'Aegis' } },
  });
  await prisma.activityEvent.updateMany({
    where: { id: 'demo-act-08' },
    data: { payload: { name: 'Deploy preview DEMO-4', kind: 'exec', agent: 'Aegis', ticket: 'DEMO-4' } },
  });

  // Usage windows. update: {} so a bridge snapshot already stored for that
  // period is left alone. A fresh database gets today / week / month.
  for (const u of USAGE) {
    const before = await prisma.usageSnapshot.findUnique({ where: { period: u.period }, select: { id: true } });
    await prisma.usageSnapshot.upsert({
      where: { period: u.period },
      update: {},
      create: {
        period: u.period,
        totalCost: u.totalCost,
        tokensIn: u.tokensIn,
        tokensOut: u.tokensOut,
        providers: u.providers,
      },
    });
    if (!before) counts.usage++;
  }

  const runNow = Date.now();
  for (const r of RUNS) {
    const before = await prisma.run.findUnique({
      where: { id: r.id },
      select: { id: true, startedAt: true, createdAt: true },
    });
    const startedAt = new Date(runNow - r.startedMinAgo * 60_000);
    const finishedAt = r.finishedMinAgo == null ? null : new Date(runNow - r.finishedMinAgo * 60_000);
    await prisma.run.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        name: r.name,
        agent: r.agent,
        status: r.status,
        progress: r.progress,
        ticketId: r.ticketId,
        startedAt,
        finishedAt,
      },
    });
    if (!before) counts.runs++;
    // A database seeded before ticketId existed keeps the row (update: {}).
    // Fill the link only while it is still null, so a second run inserts 0.
    if (r.ticketId) {
      await prisma.run.updateMany({
        where: { id: r.id, ticketId: null },
        data: { ticketId: r.ticketId },
      });
    }
    // The first ticket-5 seed stamped every run with the same instant as
    // createdAt. Pull those apart once, measured from createdAt, so a later
    // seed does not move them again.
    if (before?.startedAt && Math.abs(before.startedAt.getTime() - before.createdAt.getTime()) < 5000) {
      await prisma.run.update({
        where: { id: r.id },
        data: {
          startedAt: new Date(before.createdAt.getTime() - r.startedMinAgo * 60_000),
          finishedAt:
            r.finishedMinAgo == null
              ? null
              : new Date(before.createdAt.getTime() - r.finishedMinAgo * 60_000),
        },
      });
    }
  }

  // Memories. Fixed ids + update: {} — a second seed inserts 0 and does not
  // rewrite a note you already have. A createdAt that landed in the future
  // (the old absolute October dates, seeded before "now") is pulled back
  // once. A memory.snapshot replaces bridge rows only, not these demo rows.
  const memoryRows = buildDemoMemories(new Date());
  for (const m of memoryRows) {
    const before = await prisma.memoryEntry.findUnique({
      where: { id: m.id },
      select: { id: true, createdAt: true },
    });
    await prisma.memoryEntry.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        title: m.title,
        body: m.body,
        agent: m.agent,
        createdAt: new Date(m.createdAt),
        kind: m.kind,
        source: m.source,
        ref: m.ref,
      },
    });
    if (!before) counts.memories++;
    else if (before.createdAt.getTime() > Date.now()) {
      await prisma.memoryEntry.update({
        where: { id: m.id },
        data: { createdAt: new Date(m.createdAt) },
      });
    }
  }

  // Mission. One settings row. update: {} so a mission you edited (including
  // a cleared one, which the page shows as the placeholder) is not restored
  // on the next seed. A fresh database gets the sample sentence.
  const missionBefore = await prisma.setting.findUnique({ where: { id: SETTING_ID }, select: { id: true } });
  await prisma.setting.upsert({
    where: { id: SETTING_ID },
    update: {},
    create: { id: SETTING_ID, mission: DEMO_MISSION },
  });
  if (!missionBefore) counts.mission++;

  // Devices. Fixed ids + update: {}. The bridge has no devices channel, so
  // these rows stay until someone deletes them. Online machines have no
  // last-seen; the offline one records minutes before this seed.
  const deviceNow = Date.now();
  for (const d of DEMO_DEVICES) {
    const before = await prisma.device.findUnique({ where: { id: d.id }, select: { id: true } });
    await prisma.device.upsert({
      where: { id: d.id },
      update: {},
      create: {
        id: d.id,
        name: d.name,
        type: d.type,
        online: d.online,
        lastSeenAt: d.lastSeenMinAgo == null ? null : new Date(deviceNow - d.lastSeenMinAgo * 60_000),
      },
    });
    if (!before) counts.devices++;
  }

  // Demo activity that still names a retired agent gets the cool name.
  for (const e of ACTIVITY) {
    const row = await prisma.activityEvent.findUnique({ where: { id: e.id }, select: { payload: true } });
    const payload = row?.payload as { agent?: string } | null;
    const next = payload?.agent ? LEGACY_AGENT_NAMES[payload.agent] : undefined;
    if (payload && next) {
      await prisma.activityEvent.update({
        where: { id: e.id },
        data: { payload: { ...payload, agent: next } },
      });
    }
  }

  // One sample tool. Fixed id + update: {} so a second seed inserts 0 and
  // does not overwrite a template you already edited. If that name was taken
  // by a different row, leave the existing row (still idempotent).
  const demoTool = {
    id: 'demo-custom-tool-brief',
    name: 'Demo brief',
    description: 'Sample prompt. A test run only fills the template inside this app.',
    promptTemplate: 'Write a short brief about {{topic}} for {{audience}}.',
    inputs: [
      { name: 'topic', label: 'Topic' },
      { name: 'audience', label: 'Audience' },
    ],
  };
  try {
    const beforeTool = await prisma.customTool.findUnique({ where: { id: demoTool.id }, select: { id: true } });
    await prisma.customTool.upsert({
      where: { id: demoTool.id },
      update: {},
      create: demoTool,
    });
    if (!beforeTool) counts.customTools++;
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err;
    console.log('[seed:demo] custom tool name already taken — left the existing row');
  }

  // What THIS run inserted (0 everywhere on a re-run = already seeded).
  console.log(
    `[seed:demo] inserted agents=${counts.agents} cronJobs=${counts.cronJobs} projects=${counts.projects} tickets=${counts.tickets} ` +
      `activity=${counts.activity} approvals=${counts.approvals} usage=${counts.usage} runs=${counts.runs} memories=${counts.memories} ` +
      `devices=${counts.devices} mission=${counts.mission} customTools=${counts.customTools} docs=${docCounts.written} (0 everywhere = already seeded; re-running is safe)`,
  );

  // Table totals AFTER the run — the idempotency check is simply "these
  // numbers do not change when you run seed:demo a second time" (as long as
  // nothing else, e.g. a running api/bridge, writes in between).
  const [agents, cronJobs, projects, tickets, activity, approvals, memories, devices, customTools] = await Promise.all([
    prisma.agent.count(),
    prisma.cronJob.count(),
    prisma.project.count(),
    prisma.ticket.count(),
    prisma.activityEvent.count(),
    prisma.approval.count(),
    prisma.memoryEntry.count(),
    prisma.device.count(),
    prisma.customTool.count(),
  ]);
  console.log(
    `[seed:demo] totals agents=${agents} cronJobs=${cronJobs} projects=${projects} tickets=${tickets} activity=${activity} approvals=${approvals} memories=${memories} devices=${devices} customTools=${customTools}`,
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
