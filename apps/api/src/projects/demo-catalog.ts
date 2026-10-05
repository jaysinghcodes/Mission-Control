/**
 * Demo projects for `npm run seed:demo` (ticket 4).
 *
 * Lives next to the API (not inside the seed script) so unit tests can
 * import it without booting Prisma. The seed script is the only writer;
 * it upserts these rows by the FIXED ids below, so a second run does not
 * insert a second copy.
 *
 * Three projects on purpose:
 *   - Demo Onboarding — 2 tickets, 1 already done ("1 of 2")
 *   - Demo Pipeline   — 3 in-flight tickets, none done
 *   - Demo Ideas      — no tickets, so the project page has a real empty state
 *
 * Tickets that are NOT in DEMO_TICKET_PROJECT stay unassigned (the FK is
 * nullable). That keeps the unfiltered board larger than any one project.
 */

export interface DemoProject {
  id: string;
  name: string;
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  { id: 'demo-project-onboarding', name: 'Demo Onboarding' },
  { id: 'demo-project-pipeline', name: 'Demo Pipeline' },
  { id: 'demo-project-ideas', name: 'Demo Ideas' },
];

/**
 * Demo ticket id → project, plus the status the seed ticket must have.
 * The status is checked (not written) by assertDemoSeedProjects so a
 * future edit to the seed list cannot silently break "1 of 2".
 */
export const DEMO_TICKET_PROJECT: Readonly<
  Record<string, { projectId: string; status: string }>
> = {
  // Onboarding: one open, one done → "1 of 2".
  'demo-ticket-1': { projectId: 'demo-project-onboarding', status: 'todo' },
  'demo-ticket-6': { projectId: 'demo-project-onboarding', status: 'done' },
  // Pipeline: in flight, none done. (Ideas is absent — it stays empty.)
  'demo-ticket-3': { projectId: 'demo-project-pipeline', status: 'build' },
  'demo-ticket-4': { projectId: 'demo-project-pipeline', status: 'qa' },
  'demo-ticket-5': { projectId: 'demo-project-pipeline', status: 'review' },
};

/** projectId for a demo ticket, or null when the sample leaves it unassigned. */
export function demoProjectIdForTicket(ticketId: string): string | null {
  return DEMO_TICKET_PROJECT[ticketId]?.projectId ?? null;
}

export interface DemoProjectSummary {
  projectId: string;
  name: string;
  done: number;
  total: number;
}

/**
 * Check that a seed ticket list still produces the sample progress numbers.
 * Throws (seed fails loudly) instead of inserting a board that no longer
 * matches what the UI walkthrough expects.
 *
 * Also the idempotency contract for LINKS: each ticket id appears at most
 * once, and every link points at one of the three fixed project ids.
 */
export function assertDemoSeedProjects(
  tickets: { id: string; status: string }[],
): DemoProjectSummary[] {
  const known = new Set(DEMO_PROJECTS.map((p) => p.id));
  const seen = new Set<string>();
  for (const [ticketId, link] of Object.entries(DEMO_TICKET_PROJECT)) {
    if (seen.has(ticketId)) {
      throw new Error(`demo ticket ${ticketId} is linked to more than one project`);
    }
    seen.add(ticketId);
    if (!known.has(link.projectId)) {
      throw new Error(
        `demo ticket ${ticketId} points at unknown project ${link.projectId}`,
      );
    }
    const row = tickets.find((t) => t.id === ticketId);
    if (!row) {
      throw new Error(`demo ticket ${ticketId} is missing from the seed list`);
    }
    if (row.status !== link.status) {
      throw new Error(
        `demo ticket ${ticketId} has status ${row.status}, expected ${link.status} so sample project progress stays stable`,
      );
    }
  }

  const summary = DEMO_PROJECTS.map((p) => {
    const rows = tickets.filter((t) => demoProjectIdForTicket(t.id) === p.id);
    return {
      projectId: p.id,
      name: p.name,
      done: rows.filter((t) => t.status === 'done').length,
      total: rows.length,
    };
  });

  // These three numbers are the walkthrough: partial, in-flight, empty.
  const onboarding = summary.find((s) => s.projectId === 'demo-project-onboarding');
  const pipeline = summary.find((s) => s.projectId === 'demo-project-pipeline');
  const ideas = summary.find((s) => s.projectId === 'demo-project-ideas');
  if (!onboarding || onboarding.done !== 1 || onboarding.total !== 2) {
    throw new Error(
      `Demo Onboarding must be 1 of 2 done, got ${onboarding?.done} of ${onboarding?.total}`,
    );
  }
  if (!pipeline || pipeline.done !== 0 || pipeline.total !== 3) {
    throw new Error(
      `Demo Pipeline must be 0 of 3 done, got ${pipeline?.done} of ${pipeline?.total}`,
    );
  }
  if (!ideas || ideas.total !== 0) {
    throw new Error(`Demo Ideas must have no tickets, got ${ideas?.total}`);
  }
  return summary;
}
