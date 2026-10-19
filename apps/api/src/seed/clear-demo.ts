import { PrismaClient } from '@prisma/client';
import { clearDemoDocs } from '../docs/demo-docs';
import { configuredDocsRoot } from '../docs/docs-path';
import { buildDemoMemories } from '../memory/demo-memories';
import { DEMO_MISSION } from '../team/demo-team';
import { syncCrewSeats } from '../settings/crew-map';
import { SETTING_ID } from '../team/mission';
import { isUntouchedDemoUsage } from '../usage/demo-usage';
import {
  DEMO_ACTIVITY_IDS,
  DEMO_AGENT_IDS,
  DEMO_AGENT_NAMES,
  DEMO_APPROVAL_IDS,
  DEMO_CRON_IDS,
  DEMO_CUSTOM_TOOL_ID,
  DEMO_DEVICE_IDS,
  DEMO_PROJECT_IDS,
  DEMO_RUN_IDS,
  DEMO_TICKET_IDS,
  LEGACY_DEMO_AGENT_NAMES,
} from './demo-ids';

/**
 * Delete only the rows `npm run seed:demo` creates.
 *
 * Match is the seeded id, or the usage marker on an untouched sample day.
 * Registered agents, snapshot agents, and rows created through the API stay.
 * A mission you edited stays. A doc whose bytes no longer match the sample stays.
 * A usage day the bridge has overwritten stays, even when the id still
 * starts with `demo-usage-`, because the marker is gone.
 *
 * Safe to run when the sample rows are already gone.
 */

export interface ClearDemoResult {
  agents: number;
  cronJobs: number;
  projects: number;
  tickets: number;
  activity: number;
  approvals: number;
  usage: number;
  runs: number;
  memories: number;
  devices: number;
  mission: number;
  customTools: number;
  docsRemoved: number;
  docsKept: number;
}

const DEMO_AGENT_NAME_LIST: string[] = [
  ...DEMO_AGENT_NAMES,
  ...LEGACY_DEMO_AGENT_NAMES,
];

export async function clearDemoData(
  prisma: PrismaClient,
  docsRoot: string = configuredDocsRoot(),
): Promise<ClearDemoResult> {
  const memoryIds = buildDemoMemories(new Date()).map((row) => row.id);
  const counts = await prisma.$transaction(async (tx) => {
    const runs = await tx.run.deleteMany({
      where: { id: { in: [...DEMO_RUN_IDS] } },
    });
    const tickets = await tx.ticket.deleteMany({
      where: { id: { in: [...DEMO_TICKET_IDS] } },
    });
    const projects = await tx.project.deleteMany({
      where: { id: { in: DEMO_PROJECT_IDS } },
    });
    const approvals = await tx.approval.deleteMany({
      where: { id: { in: [...DEMO_APPROVAL_IDS] } },
    });
    const activity = await tx.activityEvent.deleteMany({
      where: { id: { in: [...DEMO_ACTIVITY_IDS] } },
    });
    const cronJobs = await tx.cronJob.deleteMany({
      where: { id: { in: [...DEMO_CRON_IDS] } },
    });
    const memories = await tx.memoryEntry.deleteMany({
      where: {
        OR: [
          { id: { in: memoryIds } },
          { source: { in: ['demo', 'seed'] }, id: { startsWith: 'demo-' } },
        ],
      },
    });
    const devices = await tx.device.deleteMany({
      where: { id: { in: DEMO_DEVICE_IDS } },
    });
    const customTools = await tx.customTool.deleteMany({
      where: { id: DEMO_CUSTOM_TOOL_ID },
    });

    const usageRows = await tx.usageBucket.findMany({
      select: { id: true, providers: true },
    });
    const usageIds = usageRows
      .filter((row) => isUntouchedDemoUsage(row))
      .map((row) => row.id);
    const usage =
      usageIds.length === 0
        ? { count: 0 }
        : await tx.usageBucket.deleteMany({ where: { id: { in: usageIds } } });

    const mission = await tx.setting.deleteMany({
      where: { id: SETTING_ID, mission: DEMO_MISSION },
    });

    const doomed = await tx.agent.findMany({
      where: {
        source: 'default',
        OR: [
          { id: { in: [...DEMO_AGENT_IDS] } },
          { name: { in: DEMO_AGENT_NAME_LIST } },
        ],
      },
      select: { id: true },
    });
    const agentIds = doomed.map((row) => row.id);
    let agents = 0;
    if (agentIds.length > 0) {
      await tx.agent.updateMany({
        where: {
          OR: [{ id: { in: agentIds } }, { parentId: { in: agentIds } }],
        },
        data: { parentId: null },
      });
      const removed = await tx.agent.deleteMany({
        where: { id: { in: agentIds } },
      });
      agents = removed.count;
      await syncCrewSeats(tx, { removed: agentIds });
    }

    return {
      agents,
      cronJobs: cronJobs.count,
      projects: projects.count,
      tickets: tickets.count,
      activity: activity.count,
      approvals: approvals.count,
      usage: usage.count,
      runs: runs.count,
      memories: memories.count,
      devices: devices.count,
      mission: mission.count,
      customTools: customTools.count,
    };
  });

  const docs = await clearDemoDocs(docsRoot);
  return { ...counts, docsRemoved: docs.removed, docsKept: docs.kept };
}
