import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { applyStoredPassword } from './auth/session-state';
import { loadEnvFiles, readEnvFile } from './load-env.js';

export { loadEnvFiles, readEnvFile };

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

function runMigrate(
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
