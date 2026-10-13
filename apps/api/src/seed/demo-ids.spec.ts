import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEMO_ACTIVITY_IDS,
  DEMO_AGENT_IDS,
  DEMO_AGENT_NAMES,
  DEMO_APPROVAL_IDS,
  DEMO_CRON_IDS,
  DEMO_CUSTOM_TOOL_ID,
  DEMO_RUN_IDS,
  DEMO_TICKET_IDS,
  LEGACY_DEMO_AGENT_NAMES,
} from './demo-ids';

const seedSource = readFileSync(
  join(__dirname, '../../scripts/seed-demo.ts'),
  'utf8',
);

describe('demo row ids', () => {
  it('matches the slugs seed:demo writes', () => {
    expect(DEMO_AGENT_IDS).toEqual([
      'speedy',
      'atlas',
      'forge',
      'sentinel',
      'echo',
      'pixel',
      'bolt',
      'ledger',
      'quill',
      'aegis',
      'patch',
      'scout',
    ]);
  });

  it('every seeded id in seed-demo.ts is on the clear list', () => {
    const ids = [...seedSource.matchAll(/id: '(demo-[^']+)'/g)].map(
      (match) => match[1],
    );
    const known = new Set<string>([
      ...DEMO_CRON_IDS,
      ...DEMO_TICKET_IDS,
      ...DEMO_ACTIVITY_IDS,
      ...DEMO_APPROVAL_IDS,
      ...DEMO_RUN_IDS,
      DEMO_CUSTOM_TOOL_ID,
    ]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(known.has(id)).toBe(true);
    for (const id of known) expect(seedSource).toContain(`'${id}'`);
  });

  it('names the same roster and legacy rows the seed script does', () => {
    for (const name of DEMO_AGENT_NAMES) {
      expect(seedSource).toContain(`name: '${name}'`);
    }
    for (const name of LEGACY_DEMO_AGENT_NAMES) {
      expect(seedSource).toContain(`'${name}'`);
    }
  });
});
