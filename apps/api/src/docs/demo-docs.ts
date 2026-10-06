import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';

/**
 * Sample docs for `npm run seed:demo` (ticket 6).
 *
 * Fixed relative paths, so a second run inserts nothing and does not
 * overwrite a file you already edited. Authors are the seeded cool names
 * (Atlas, Speedy, Quill, …) so the Docs cards resolve Name · Function
 * and the existing robots. The set includes a formatted spec (headings,
 * a code block, links), a deliberately broken note, and a filename with
 * both a space and a non-ASCII character.
 */

export interface DemoDocFile {
  /** Root-relative posix path. Never absolute, never `..`. */
  relative: string;
  contents: string;
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

export const DEMO_DOC_AUTHORS: readonly string[] = ROSTER;

export const DEMO_DOCS: DemoDocFile[] = [
  {
    relative: 'specs/app-redesign.md',
    contents: `---
title: Ticket 13 · App-wide redesign
type: Spec
author: Atlas
updated: 2026-10-06T14:12:00.000Z
---

# One purpose per page

The dashboard keeps one job on each screen. A summary sits under the title. Details stay behind a click. Red is only for something that needs you.

## How a card is built

\`\`\`ts
type DocCard = {
  title: string
  type: 'Spec' | 'Brief' | 'Note'
}
\`\`\`

Read the [setup guide](#/connect) before changing tokens, and the [Mission Control repo](https://github.com/jaysinghcodes/mission-control) for the rest.

## What stays put

- The cards grid, the type filters, and the author line (robot, then Name · Function).
- Light and dark, using the tokens already on the page.
`,
  },
  {
    relative: 'briefs/morning-brief.md',
    contents: `---
title: Morning Brief · today
type: Brief
author: Speedy
updated: 2026-10-06T13:40:00.000Z
---

# What is moving

Forge is on the calendar week view. Sentinel is in the regression pass. Aegis is waiting on the preview deploy.

## Waiting

Nothing else is blocked. Quill has the release note in draft.
`,
  },
  {
    relative: 'notes/Release notes.md',
    contents: `---
title: Release notes
type: Note
author: Quill
state: Draft
updated: 2026-10-06T12:15:00.000Z
---

# Next cut

Draft notes for the next cut. Not published.

- Docs read from the configured folder.
- Memory keeps demo rows when a live id collides.
`,
  },
  {
    relative: 'specs/security-review.md',
    contents: `---
title: Security review: deploy script
type: Spec
author: Aegis
state: In review
updated: 2026-10-05T21:03:00.000Z
---

# Deploys wait

The preview script does not run unattended. An approval has to land first.
`,
  },
  {
    relative: 'specs/projects.md',
    contents: `---
title: Projects
type: Spec
author: Atlas
updated: 2026-10-05T16:20:00.000Z
---

# One project or none

A ticket sits in one project or in none. Archive hides the project and keeps the tickets.
`,
  },
  {
    relative: 'notes/broken-markdown.md',
    contents: `---
title: Broken on purpose
type: Note
author: Sentinel
updated: 2026-10-05T14:05:00.000Z
---

# This note is malformed

The reader has to show it without throwing.

<script>alert('nope')</script>

<img src=x onerror=alert(1)>

[bad](javascript:alert(1))

[encoded](&#106;avascript:alert(1))

\`\`\`js
function oops() {
  return "unclosed

**bold never closes

[a link that never ends](https://example.com

| table | missing
`,
  },
  {
    relative: 'notes/Café checklist.md',
    contents: `---
title: Café checklist
type: Note
author: Echo
updated: 2026-10-03T15:00:00.000Z
---

# Spaces and unicode

This file is named with a space and an é so the library has to open both.

- Fresh clone
- \`npm run seed:demo\`
- Both themes
`,
  },
  {
    relative: 'notes/bridge-setup.md',
    contents: `---
title: Bridge setup guide
type: Note
author: Bolt
updated: 2026-10-01T16:00:00.000Z
---

# Optional bridge

\`python3 bridge/mc-bridge-sync.py\` posts agents, sessions, usage, and approvals. Docs do not need it. \`npm run seed:demo\` is enough for this page.
`,
  },
];

export interface DemoDocWriteResult {
  written: number;
  skipped: number;
}

/**
 * Create any sample file that is not already there.
 * An existing file is left alone, even when its bytes differ, so a re-seed
 * does not undo an edit. Running twice writes 0.
 */
export async function writeDemoDocs(root: string): Promise<DemoDocWriteResult> {
  const existing = await stat(root).catch(() => null);
  if (existing && !existing.isDirectory()) {
    throw new Error(`DOCS_ROOT is not a directory: ${root}`);
  }
  await mkdir(root, { recursive: true });

  let written = 0;
  let skipped = 0;
  for (const doc of DEMO_DOCS) {
    const dest = destFor(root, doc.relative);
    const current = await readFile(dest, 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    if (current != null) {
      skipped += 1;
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, doc.contents, 'utf8');
    written += 1;
  }
  return { written, skipped };
}

function destFor(root: string, relative: string): string {
  const parts = relative.split('/');
  if (parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`demo doc path escapes the docs root: ${relative}`);
  }
  return path.join(root, ...parts);
}
