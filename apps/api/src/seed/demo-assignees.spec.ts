import { readFileSync } from 'fs';
import { join } from 'path';
import { demoAgentId, demoAssigneeRewrites } from './demo-assignees';

const seedSource = readFileSync(
  join(__dirname, '../../scripts/seed-demo.ts'),
  'utf8',
);

describe('demo assignees', () => {
  it('maps a crew name and a legacy name to the agent id', () => {
    expect(demoAgentId('Forge')).toBe('forge');
    expect(
      demoAssigneeRewrites(['Forge', 'Atlas', 'Speedy'], {
        'Demo Builder': 'Forge',
        'Demo Lead': 'Speedy',
      }),
    ).toEqual([
      { from: 'Forge', to: 'forge' },
      { from: 'Atlas', to: 'atlas' },
      { from: 'Speedy', to: 'speedy' },
      { from: 'Demo Builder', to: 'forge' },
      { from: 'Demo Lead', to: 'speedy' },
    ]);
  });

  it('seed:demo writes ticket assignees and run agents as ids', () => {
    const tickets = seedSource.slice(
      seedSource.indexOf('const TICKETS'),
      seedSource.indexOf('const ACTIVITY'),
    );
    const runs = seedSource.slice(
      seedSource.indexOf('const RUNS'),
      seedSource.indexOf('async function main'),
    );
    expect(tickets).toContain("assignee: demoAgentId('Forge')");
    expect(tickets).not.toContain("assignee: 'Forge'");
    expect(runs).toContain("agent: demoAgentId('Forge')");
    expect(runs).not.toContain("agent: 'Forge'");
    const activity = seedSource.slice(
      seedSource.indexOf('const ACTIVITY'),
      seedSource.indexOf('const APPROVALS'),
    );
    expect(activity).toContain("agent: demoAgentId('Forge')");
    expect(activity).not.toContain("agent: 'Forge'");
    expect(seedSource).toContain('demoAssigneeRewrites');
    expect(seedSource).toContain("agentId: demoAgentId('Aegis')");
    expect(seedSource).not.toContain("agentId: 'Aegis'");
    expect(seedSource).not.toContain("agentId: 'Sentinel'");
  });
});
