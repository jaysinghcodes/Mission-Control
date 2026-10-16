import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Keep unit tests off the repo session file. A worker that logs out
 * would otherwise bump apps/api/data/session-state.json.
 */
if (!process.env.SESSION_STATE_PATH?.trim()) {
  process.env.SESSION_STATE_PATH = join(
    mkdtempSync(join(tmpdir(), 'mc-session-')),
    'state.json',
  );
}
