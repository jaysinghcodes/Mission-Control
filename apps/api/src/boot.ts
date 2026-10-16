import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { applyStoredPassword } from './auth/session-state';

/**
 * Startup for the API process.
 *
 * Loads the root `.env` (and `apps/api/.env` when that file exists) without
 * replacing variables that are already set, including a blank value. Compose
 * injects the container environment and ships no `.env` file, so this is a
 * no op there. Then runs `prisma migrate deploy` so a fresh database is
 * ready before Nest listens. Reviewed SQL only: this does not create
 * migrations.
 */

export function findApiDir(start: string = __dirname): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'prisma.config.ts'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (existsSync(resolve(process.cwd(), 'prisma.config.ts'))) {
    return process.cwd();
  }
  throw new Error(
    'Could not find the API directory (prisma.config.ts). Start the API from apps/api.',
  );
}

/** KEY=VALUE lines. Blank values are kept. Comments and empty lines are skipped. */
export function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const body = trimmed.startsWith('export ')
      ? trimmed.slice(7).trim()
      : trimmed;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * `apps/api/.env` first, then the repo root `.env`. An existing key wins,
 * so a blank `INGEST_TOKEN` in the process stays blank.
 */
export function loadEnvFiles(
  apiDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const files = [resolve(apiDir, '.env'), resolve(apiDir, '..', '..', '.env')];
  const loaded: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const parsed = readEnvFile(file);
    let applied = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) {
        env[key] = value;
        applied = true;
      }
    }
    if (applied || Object.keys(parsed).length > 0) loaded.push(file);
  }
  return loaded;
}

export function runMigrate(
  apiDir: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    env,
    stdio: 'inherit',
  });
}

export function bootApi(): void {
  const apiDir = findApiDir();
  const loaded = loadEnvFiles(apiDir, process.env);
  if (loaded.length > 0) {
    console.log(`loaded env from ${loaded.join(', ')}`);
  }
  applyStoredPassword(process.env);
  console.log('running prisma migrate deploy');
  try {
    runMigrate(apiDir, process.env);
  } catch (err) {
    console.error('prisma migrate deploy failed. The API will not start.');
    throw err;
  }
}
