import { tmpdir } from 'os';
import { join } from 'path';

/** Env var set by jest global setup so workers open this run's state file. */
export const TEST_DB_STATE_ENV = 'MC_TEST_DB_STATE_FILE';

const PREFIX = 'mission-control-api-jest-db';

/** Older runs used one shared file. Reaping still recognizes it. */
export function legacyStateFile(): string {
  return join(tmpdir(), `${PREFIX}.json`);
}

/** One state file per run: the owner pid plus a random id. */
export function stateFileForRun(pid: number, id: string): string {
  return join(tmpdir(), `${PREFIX}-${pid}-${id}.json`);
}

export function currentStateFile(env: NodeJS.ProcessEnv = process.env): string {
  const selected = env[TEST_DB_STATE_ENV]?.trim();
  if (selected) return selected;
  return legacyStateFile();
}

export function isStateFileName(name: string): boolean {
  return (
    name === `${PREFIX}.json` ||
    new RegExp(`^${PREFIX}-\\d+-[a-f0-9]+\\.json$`).test(name)
  );
}
