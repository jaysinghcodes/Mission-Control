import { spawn, spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Client } from 'pg';
import { findApiDir, readEnvFile } from './boot';
import {
  TEST_DB_STATE_ENV,
  currentStateFile,
  isStateFileName,
  stateFileForRun,
} from './test-db-file';

/**
 * npm test connects with TEST_DATABASE_URL only.
 * DATABASE_URL is read for the server (user, password, host, port) and for
 * the live database name we must not open. No connection string passed to
 * pg or to prisma migrate deploy is the live URL.
 */

export const LIVE_DB_REFUSAL =
  'Tests will not run against your live database. Set TEST_DATABASE_URL.';

const SAFE_NAME = /^mc_test_[a-z0-9]+$/;
const DEFAULT_SERVER = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

export interface DbIdentity {
  host: string;
  port: string;
  database: string;
}

export interface TestDbState {
  testUrl: string;
  adminUrl: string;
  kind: 'database' | 'schema';
  name: string;
  disposable: boolean;
  ownerPid?: number;
  dropped?: boolean;
}

export type TestDbDecision =
  | { action: 'refuse'; message: string }
  | { action: 'use'; url: string }
  | { action: 'create' };

type SqlClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

function parsePostgresUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  let httpish = '';
  if (lower.startsWith('postgresql://')) {
    httpish = `http://${trimmed.slice('postgresql://'.length)}`;
  } else if (lower.startsWith('postgres://')) {
    httpish = `http://${trimmed.slice('postgres://'.length)}`;
  } else {
    return null;
  }
  try {
    return new URL(httpish);
  } catch {
    return null;
  }
}

function formatPostgresUrl(url: URL, original: string): string {
  const protocol = original.trim().toLowerCase().startsWith('postgres://')
    ? 'postgres:'
    : 'postgresql:';
  return url.toString().replace(/^http:/i, protocol);
}

function hostKey(hostname: string): string {
  let host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '0:0:0:0:0:0:0:1') host = '::1';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return 'loopback';
  }
  return host;
}

export function databaseIdentity(raw: string | undefined): DbIdentity | null {
  if (!raw?.trim()) return null;
  const url = parsePostgresUrl(raw);
  if (!url) return null;
  const path = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
  const database = (
    path || decodeURIComponent(url.username || 'postgres')
  ).toLowerCase();
  return {
    host: hostKey(url.hostname),
    port: url.port || '5432',
    database,
  };
}

export function sameDatabase(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const a = databaseIdentity(left);
  const b = databaseIdentity(right);
  if (!a || !b) return false;
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

export function decideTestDatabase(input: {
  testUrl?: string;
  liveUrl?: string;
}): TestDbDecision {
  const testUrl = input.testUrl?.trim();
  const liveUrl = input.liveUrl?.trim();
  if (testUrl) {
    if (liveUrl && sameDatabase(testUrl, liveUrl)) {
      return { action: 'refuse', message: LIVE_DB_REFUSAL };
    }
    return { action: 'use', url: testUrl };
  }
  return { action: 'create' };
}

/**
 * Keep the host and port of `raw`. Replace only the parts that are set.
 * A database change drops schema and options so the new URL is that database.
 */
export function retargetConnection(
  raw: string,
  parts: { user?: string; password?: string; database?: string },
): string {
  const url = parsePostgresUrl(raw);
  if (!url) {
    throw new Error(
      'Could not read the database server from the connection URL.',
    );
  }
  if (parts.user !== undefined) url.username = parts.user;
  if (parts.password !== undefined) url.password = parts.password;
  if (parts.database !== undefined) {
    url.pathname = `/${parts.database}`;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
  }
  return formatPostgresUrl(url, raw);
}

export function replaceDatabase(raw: string, database: string): string {
  return retargetConnection(raw, { database });
}

export function withSearchPath(raw: string, schema: string): string {
  assertSafeName(schema);
  const url = parsePostgresUrl(raw);
  if (!url) {
    throw new Error(
      'Could not read the database server from the connection URL.',
    );
  }
  url.searchParams.delete('schema');
  url.searchParams.set('options', `-c search_path=${schema}`);
  return formatPostgresUrl(url, raw);
}

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error('refusing an unsafe test database name');
  }
}

function assertNotLive(target: string, liveUrl: string | undefined): void {
  if (liveUrl && sameDatabase(target, liveUrl)) {
    console.error(LIVE_DB_REFUSAL);
    process.exit(1);
  }
}

function permissionDenied(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String(err.code) : '';
  if (code === '42501') return true;
  const message = 'message' in err ? String(err.message).toLowerCase() : '';
  return message.includes('permission denied');
}

function readFileUrl(
  key: 'DATABASE_URL' | 'TEST_DATABASE_URL',
): string | undefined {
  const apiDir = findApiDir();
  const files = [resolve(apiDir, '.env'), resolve(apiDir, '..', '..', '.env')];
  for (const file of files) {
    const value = readEnvFile(file)[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function configuredUrl(
  key: 'DATABASE_URL' | 'TEST_DATABASE_URL',
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, key)) {
    return env[key]?.trim() || undefined;
  }
  if (env !== process.env) return undefined;
  return readFileUrl(key);
}

function adminDatabase(liveDatabase: string | undefined): string {
  if (liveDatabase && liveDatabase.toLowerCase() === 'postgres') {
    return 'template1';
  }
  return 'postgres';
}

async function openPg(url: string): Promise<SqlClient> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function createThrowaway(
  serverUrl: string,
  liveUrl: string | undefined,
  opener: (url: string) => Promise<SqlClient> = openPg,
): Promise<TestDbState> {
  const live = databaseIdentity(liveUrl);
  const name = `mc_test_${randomBytes(8).toString('hex')}`;
  assertSafeName(name);
  const adminName = adminDatabase(live?.database);
  const adminUrl = replaceDatabase(serverUrl, adminName);
  assertNotLive(adminUrl, liveUrl);
  const client = await opener(adminUrl);
  try {
    try {
      await client.query(`CREATE DATABASE "${name}"`);
      const testUrl = replaceDatabase(serverUrl, name);
      assertNotLive(testUrl, liveUrl);
      return {
        testUrl,
        adminUrl,
        kind: 'database',
        name,
        disposable: true,
        ownerPid: process.pid,
      };
    } catch (err) {
      if (!permissionDenied(err)) throw err;
      // template1 is only the admin connection when the live database is
      // named postgres. A schema there would be copied into new databases.
      if (sameDatabase(adminUrl, liveUrl) || adminName === 'template1') {
        if (sameDatabase(adminUrl, liveUrl)) {
          console.error(LIVE_DB_REFUSAL);
          process.exit(1);
        }
        throw new Error(
          'Could not create a throwaway test database. Set TEST_DATABASE_URL to a database that is not DATABASE_URL.',
        );
      }
      await client.query(`CREATE SCHEMA "${name}"`);
      const testUrl = withSearchPath(adminUrl, name);
      assertNotLive(testUrl, liveUrl);
      return {
        testUrl,
        adminUrl,
        kind: 'schema',
        name,
        disposable: true,
        ownerPid: process.pid,
      };
    }
  } finally {
    await client.end();
  }
}

function migrate(url: string, liveUrl: string | undefined): void {
  assertNotLive(url, liveUrl);
  const apiDir = findApiDir();
  const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url };
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(
      `prisma migrate deploy failed for the test database.\n${detail}`,
    );
  }
}

function writeState(
  state: TestDbState,
  file: string = currentStateFile(),
): void {
  writeFileSync(file, JSON.stringify(state));
}

export function readState(
  file: string = currentStateFile(),
): TestDbState | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as TestDbState;
    if (!parsed || typeof parsed.testUrl !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function dropScript(): string {
  return resolve(__dirname, 'test-db-drop.cjs');
}

export function dropStateFile(file: string): void {
  const result = spawnSync(process.execPath, [dropScript(), file], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(detail || 'could not drop the throwaway test database');
  }
}

function armWatcher(file: string): void {
  const child = spawn(
    process.execPath,
    [dropScript(), file, '--wait', String(process.pid)],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

/** True when `pid` is still running. EPERM means it exists and is not ours. */
export function pidAlive(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || !pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    return code === 'EPERM';
  }
}

function allocateStateFile(): string {
  const existing = process.env[TEST_DB_STATE_ENV]?.trim();
  if (existing) return existing;
  const file = stateFileForRun(process.pid, randomBytes(4).toString('hex'));
  process.env[TEST_DB_STATE_ENV] = file;
  return file;
}

/**
 * Drop disposable databases left by runs whose owner process is gone.
 * A live ownerPid is another npm test, so its database stays.
 */
export function reapDeadTestDatabases(keepFile?: string): void {
  let names: string[] = [];
  try {
    names = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of names) {
    if (!isStateFileName(name)) continue;
    const file = join(tmpdir(), name);
    if (keepFile && file === keepFile) continue;
    const state = readState(file);
    if (!state?.disposable || state.dropped) continue;
    if (pidAlive(state.ownerPid)) continue;
    try {
      dropStateFile(file);
    } catch {
      // The leftover database is dropped on a best effort basis.
    }
  }
}

function publish(url: string): void {
  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
}

export async function prepareJestDatabase(
  env: NodeJS.ProcessEnv = process.env,
  opener?: (url: string) => Promise<SqlClient>,
): Promise<void> {
  const liveUrl = configuredUrl('DATABASE_URL', env);
  const testUrl = configuredUrl('TEST_DATABASE_URL', env);
  const decision = decideTestDatabase({ testUrl, liveUrl });
  if (decision.action === 'refuse') {
    console.error(LIVE_DB_REFUSAL);
    process.exit(1);
  }

  const file = allocateStateFile();
  reapDeadTestDatabases(file);

  let state: TestDbState;
  if (decision.action === 'use') {
    assertNotLive(decision.url, liveUrl);
    const identity = databaseIdentity(decision.url);
    state = {
      testUrl: decision.url,
      adminUrl: replaceDatabase(
        decision.url,
        adminDatabase(identity?.database),
      ),
      kind: 'database',
      name: identity?.database ?? '',
      disposable: false,
      ownerPid: process.pid,
    };
    migrate(decision.url, liveUrl);
  } else {
    const serverUrl = liveUrl?.trim() || DEFAULT_SERVER;
    state = await createThrowaway(serverUrl, liveUrl, opener);
    try {
      migrate(state.testUrl, liveUrl);
    } catch (err) {
      writeState(state, file);
      try {
        dropStateFile(file);
      } catch {
        // The watcher or the next run still tries to drop it.
      }
      throw err;
    }
  }

  writeState(state, file);
  if (env === process.env) publish(state.testUrl);
  if (state.disposable) armWatcher(file);
}

/** Worker setup. Replaces DATABASE_URL before any suite connects. */
export function installWorkerDatabase(): void {
  const state = readState();
  if (!state?.testUrl?.trim()) return;
  const liveCandidates: string[] = [];
  const fromFile = readFileUrl('DATABASE_URL');
  if (fromFile) liveCandidates.push(fromFile);
  const shell = process.env.DATABASE_URL?.trim();
  if (shell && shell !== state.testUrl) liveCandidates.push(shell);
  for (const live of liveCandidates) {
    if (sameDatabase(state.testUrl, live)) {
      console.error(LIVE_DB_REFUSAL);
      process.exit(1);
    }
  }
  publish(state.testUrl);
}

export function dropPreparedDatabase(): void {
  const file = currentStateFile();
  const state = readState(file);
  if (!state?.disposable || state.dropped) return;
  dropStateFile(file);
}
