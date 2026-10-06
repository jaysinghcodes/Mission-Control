/**
 * Sample memories for `npm run seed:demo` (ticket 5).
 *
 * Fixed ids so a second seed inserts nothing. Dates are relative to seed
 * time in America/Chicago, and every instant is at or before that moment:
 * a busy day is yesterday, and the 11:58 PM note sits on an earlier day.
 * Agents are the seeded cool names (Forge, Aegis, …) so the existing robots
 * and "Name · Function" captions resolve.
 */

import { chicagoDay, chicagoWallTime, shiftChicagoDay } from './chicago-day';

export type DemoMemoryKind = 'long-term' | 'daily' | 'other';

export interface DemoMemory {
  id: string;
  title: string;
  body: string;
  agent: string;
  /** ISO-8601 instant. */
  createdAt: string;
  kind: DemoMemoryKind;
  source: 'demo';
  ref: string | null;
}

const ROSTER = [
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

const LONG_NOTE = [
  'Forge keeps this note so the next session does not have to reconstruct the week from chat.',
  'The board columns are To-Do, Build, QA, Review, and Done. A ticket sits in one project or in none. Archive hides the project and leaves the tickets where they are.',
  'Pipeline time comes from the run that points at the ticket id. A matching title is not a link. When no run points at the ticket, the line falls back to the moment the ticket was created.',
  'Approvals decided today are a calendar day in America/Chicago. A rolling twenty-four hour window pulled in yesterday evening and dropped this morning, which made the count wrong around midnight.',
  'Memory is grouped the same way. A note written at 11:58 PM Central belongs to that day. A note written at 12:02 AM belongs to the next day. Daylight saving changes the offset, not the rule: the day is the one the clock in Chicago shows.',
  'Daily notes live in memory/YYYY-MM-DD.md inside the agent workspace, including the slugged memory/YYYY-MM-DD-name.md files OpenClaw writes. The long-term file is MEMORY.md at the workspace root. The bridge reads those files and posts memory.snapshot. The web app never opens the disk.',
  'If the bridge is down and this table is empty, the page says so and points at Setup. It does not crash, and it does not look in /tmp or the home directory.',
  'Search matches the title, the body, and the agent. The kind control is All, Long-term, or Daily notes. Jumping to a date with nothing saved leaves the page up and says the day is empty.',
  'This note is long on purpose. It should wrap inside the reader, keep its paragraph breaks, and scroll without the rest of the page jumping sideways. A busy day holds more than fifty short notes, and that list scrolls on its own.',
  'Speedy runs the council. Atlas keeps the project list honest. Sentinel owns the regression pass. Echo files research. Pixel checks the screenshots in both themes. Bolt watches the bridge. Ledger counts usage. Quill writes the release note. Aegis will not deploy until someone approves. Patch answers setup questions. Scout watches upstream.',
  ...Array.from({ length: 36 }, (_, i) => {
    const n = i + 1;
    return `${n}. Pass ${n}: the reader still wraps this line, the day list still scrolls, and the note stays attached to Forge.`;
  }),
].join('\n\n');

function bulkDay(day: string): DemoMemory[] {
  // 8:00 AM Chicago, then every 8 minutes. 52 notes finish mid-afternoon
  // on that same calendar day, which the caller picks in the past.
  const start = chicagoWallTime(day, 8, 0).getTime();
  return Array.from({ length: 52 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    const agent = ROSTER[i % ROSTER.length];
    return {
      id: `demo-memory-bulk-${n}`,
      title: `Day note ${n}`,
      body: `${agent} saved note ${n} on a busy day. It is short so the list can hold more than fifty and still scroll.`,
      agent,
      createdAt: new Date(start + i * 8 * 60_000).toISOString(),
      kind: 'daily' as const,
      source: 'demo' as const,
      ref: null,
    };
  });
}

/**
 * Build the sample set for one seed instant. Every createdAt is <= now.
 * Ids do not depend on now, so a second seed still inserts nothing.
 */
export function buildDemoMemories(now: Date = new Date()): DemoMemory[] {
  const today = chicagoDay(now);
  const yesterday = shiftChicagoDay(today, -1);
  const twoAgo = shiftChicagoDay(today, -2);
  const threeAgo = shiftChicagoDay(today, -3);
  const fourAgo = shiftChicagoDay(today, -4);
  return [
    {
      id: 'demo-memory-long',
      title: 'Long note on the build',
      body: LONG_NOTE,
      agent: 'Forge',
      createdAt: new Date(now.getTime() - 90 * 60_000).toISOString(),
      kind: 'long-term',
      source: 'demo',
      ref: null,
    },
    {
      id: 'demo-memory-aegis',
      title: 'Preview deploys wait',
      body: 'Aegis will not run the preview deploy until the approval on DEMO-4 is decided. The script stays gated.',
      agent: 'Aegis',
      createdAt: chicagoWallTime(yesterday, 15, 15).toISOString(),
      kind: 'daily',
      source: 'demo',
      ref: null,
    },
    {
      id: 'demo-memory-quill',
      title: 'Release note draft',
      body: 'Quill started the release note for the next cut. It names the project filter and the memory page, and it is still a draft.',
      agent: 'Quill',
      createdAt: chicagoWallTime(yesterday, 8, 40).toISOString(),
      kind: 'daily',
      source: 'demo',
      ref: null,
    },
    {
      id: 'demo-memory-echo',
      title: 'Calendar patterns',
      body: 'Echo wrote down that the week grid starts on Monday and that an all-day job has no clock time.',
      agent: 'Echo',
      createdAt: chicagoWallTime(fourAgo, 11, 0).toISOString(),
      kind: 'daily',
      source: 'demo',
      ref: null,
    },
    {
      id: 'demo-memory-sentinel',
      title: 'Regression pass notes',
      body: 'Sentinel checked the ticket board after a reload. The columns matched the database, including an empty Review column.',
      agent: 'Sentinel',
      createdAt: chicagoWallTime(twoAgo, 16, 30).toISOString(),
      kind: 'daily',
      source: 'demo',
      ref: null,
    },
    {
      id: 'demo-memory-midnight',
      title: 'Handoff before midnight',
      body: 'Speedy closed the day at 11:58 PM Central. This note belongs on that Chicago day, not the next morning.',
      agent: 'Speedy',
      createdAt: chicagoWallTime(threeAgo, 23, 58).toISOString(),
      kind: 'daily',
      source: 'demo',
      ref: null,
    },
    ...bulkDay(yesterday),
  ];
}
