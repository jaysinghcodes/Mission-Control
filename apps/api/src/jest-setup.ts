import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installWorkerDatabase } from './test-database';

/**
 * Point this worker at the isolated test database before any suite reads
 * the environment. The URL comes from jest global setup. DATABASE_URL in
 * the shell or in .env is not a connection target.
 */
installWorkerDatabase();

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
