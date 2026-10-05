import {
  DEMO_PROJECTS,
  DEMO_TICKET_PROJECT,
  assertDemoSeedProjects,
  demoProjectIdForTicket,
} from './demo-catalog';

/**
 * The demo seed's project catalog (ticket 4). The seed script calls
 * assertDemoSeedProjects on its ticket list before writing, so a drift
 * between the two fails `npm run seed:demo` instead of shipping a board
 * that no longer shows "1 of 2". These tests pin the catalog itself.
 */
describe('demo seed projects', () => {
  const ticketsFromCatalog = Object.entries(DEMO_TICKET_PROJECT).map(
    ([id, link]) => ({ id, status: link.status }),
  );

  it('has exactly three projects with fixed, unique ids and names', () => {
    expect(DEMO_PROJECTS).toHaveLength(3);
    expect(new Set(DEMO_PROJECTS.map((p) => p.id)).size).toBe(3);
    expect(new Set(DEMO_PROJECTS.map((p) => p.name.trim().toLowerCase())).size).toBe(3);
    for (const p of DEMO_PROJECTS) {
      expect(p.id.startsWith('demo-project-')).toBe(true);
      expect(p.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('attaches some tickets, never two projects to one ticket, and leaves one project empty', () => {
    const ids = Object.keys(DEMO_TICKET_PROJECT);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const used = new Set(Object.values(DEMO_TICKET_PROJECT).map((l) => l.projectId));
    const empty = DEMO_PROJECTS.filter((p) => !used.has(p.id));
    expect(empty.map((p) => p.name)).toEqual(['Demo Ideas']);
  });

  it('is 1 of 2 on Onboarding, 0 of 3 on Pipeline, and empty on Ideas', () => {
    const summary = assertDemoSeedProjects(ticketsFromCatalog);
    expect(summary).toEqual([
      { projectId: 'demo-project-onboarding', name: 'Demo Onboarding', done: 1, total: 2 },
      { projectId: 'demo-project-pipeline', name: 'Demo Pipeline', done: 0, total: 3 },
      { projectId: 'demo-project-ideas', name: 'Demo Ideas', done: 0, total: 0 },
    ]);
  });

  it('rejects a seed list that would no longer be 1 of 2', () => {
    const broken = ticketsFromCatalog.map((t) =>
      t.id === 'demo-ticket-6' ? { ...t, status: 'todo' } : t,
    );
    // The status check fires first — a ticket that is no longer `done` must
    // not be allowed to silently change "1 of 2" into "0 of 2".
    expect(() => assertDemoSeedProjects(broken)).toThrow(/demo-ticket-6/);
  });

  it('demoProjectIdForTicket returns null for tickets the seed leaves loose', () => {
    expect(demoProjectIdForTicket('demo-ticket-1')).toBe('demo-project-onboarding');
    expect(demoProjectIdForTicket('demo-ticket-2')).toBeNull();
  });
});
