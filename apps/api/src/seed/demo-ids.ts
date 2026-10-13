import { slugFromName } from '../agents/agent-merge';
import { DEMO_PROJECTS } from '../projects/demo-catalog';
import { DEMO_DEVICES } from '../team/demo-team';

/**
 * Identity of every row `npm run seed:demo` inserts.
 *
 * `seed:clear` deletes these ids (and the usage marker) and nothing else.
 * A registered or snapshot agent keeps its row even when the name matches
 * the sample roster. Keep this list aligned with scripts/seed-demo.ts.
 */

export const DEMO_AGENT_NAMES = [
  'Speedy',
  'Atlas',
  'Forge',
  'Sentinel',
  'Echo',
  'Pixel',
  'Bolt',
  'Ledger',
  'Quill',
  'Aegis',
  'Patch',
  'Scout',
] as const;

/** Previous seed names. A leftover default row with one of these is still sample data. */
export const LEGACY_DEMO_AGENT_NAMES = [
  'Demo Lead',
  'Demo Planner',
  'Demo Builder',
  'Demo Tester',
  'Demo Researcher',
  'Demo Designer',
  'Demo Writer',
  'Demo Monitor',
] as const;

export const DEMO_AGENT_IDS: readonly string[] = DEMO_AGENT_NAMES.map(
  (name) => {
    const id = slugFromName(name);
    if (!id) throw new Error(`demo agent name has no slug: ${name}`);
    return id;
  },
);

export const DEMO_CRON_IDS = [
  'demo-cron-morning-brief',
  'demo-cron-trend-radar',
  'demo-cron-weekly-review',
  'demo-cron-backlog-groom',
  'demo-cron-security-scan',
  'demo-cron-inbox-poll',
] as const;

export const DEMO_TICKET_IDS = [
  'demo-ticket-1',
  'demo-ticket-2',
  'demo-ticket-3',
  'demo-ticket-4',
  'demo-ticket-5',
  'demo-ticket-6',
  'demo-ticket-7',
  'demo-ticket-8',
] as const;

export const DEMO_ACTIVITY_IDS = [
  'demo-act-01',
  'demo-act-02',
  'demo-act-03',
  'demo-act-04',
  'demo-act-05',
  'demo-act-06',
  'demo-act-07',
  'demo-act-08',
  'demo-act-09',
  'demo-act-10',
] as const;

export const DEMO_APPROVAL_IDS = [
  'demo-approval-1',
  'demo-approval-2',
] as const;

export const DEMO_RUN_IDS = [
  'demo-run-1',
  'demo-run-2',
  'demo-run-3',
  'demo-run-4',
  'demo-run-5',
  'demo-run-6',
] as const;

export const DEMO_CUSTOM_TOOL_ID = 'demo-custom-tool-brief';

export const DEMO_PROJECT_IDS = DEMO_PROJECTS.map((project) => project.id);

export const DEMO_DEVICE_IDS = DEMO_DEVICES.map((device) => device.id);
