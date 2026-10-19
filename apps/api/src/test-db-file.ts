import { tmpdir } from 'os';
import { join } from 'path';

/** Shared with jest setup, teardown, and the interrupt watcher. */
export const TEST_DB_STATE_FILE = join(
  tmpdir(),
  'mission-control-api-jest-db.json',
);
