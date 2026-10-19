import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from 'pg';
import { findApiDir } from './boot';
import {
  LIVE_DB_REFUSAL,
  createThrowaway,
  databaseIdentity,
  decideTestDatabase,
  dropStateFile,
  prepareJestDatabase,
  readState,
  sameDatabase,
  type TestDbState,
} from './test-database';

const LIVE = 'postgresql://postgres:postgres@localhost:5432/mission_control';
const LOOPBACK_ALIAS =
  'postgresql://other:secret@127.0.0.1/mission_control?sslmode=disable';

function exitSpy(): jest.SpyInstance {
  return jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit ${code}`);
  });
}

describe('test database isolation', () => {
  it('treats localhost and 127.0.0.1 as the same database', () => {
    expect(sameDatabase(LIVE, LOOPBACK_ALIAS)).toBe(true);
    expect(
      sameDatabase(
        'postgres://postgres@localhost/mission_control',
        'postgresql://postgres:postgres@[::1]:5432/mission_control',
      ),
    ).toBe(true);
    expect(
      sameDatabase(
        'postgresql://postgres:postgres@localhost:5432/mission_control',
        'postgresql://postgres:postgres@localhost:5433/mission_control',
      ),
    ).toBe(false);
    expect(
      sameDatabase(
        LIVE,
        'postgresql://postgres:postgres@127.0.0.1:5432/mission_control_test',
      ),
    ).toBe(false);
    expect(databaseIdentity(LIVE)).toEqual({
      host: 'loopback',
      port: '5432',
      database: 'mission_control',
    });
    expect(
      databaseIdentity('postgresql://postgres@localhost/Mission_Control')
        ?.database,
    ).toBe('mission_control');
  });

  it('refuses a test URL that names the live database', () => {
    expect(
      decideTestDatabase({ testUrl: LOOPBACK_ALIAS, liveUrl: LIVE }),
    ).toEqual({
      action: 'refuse',
      message: LIVE_DB_REFUSAL,
    });
    expect(
      decideTestDatabase({
        testUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/other_db',
        liveUrl: LIVE,
      }),
    ).toEqual({
      action: 'use',
      url: 'postgresql://postgres:postgres@127.0.0.1:5432/other_db',
    });
    expect(decideTestDatabase({ liveUrl: LIVE })).toEqual({ action: 'create' });
  });

  it('exits with the refusal line and does not connect', async () => {
    const opener = jest.fn();
    const exit = exitSpy();
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await expect(
      prepareJestDatabase(
        {
          DATABASE_URL: LIVE,
          TEST_DATABASE_URL: LOOPBACK_ALIAS,
        },
        opener,
      ),
    ).rejects.toThrow('exit 1');
    expect(error).toHaveBeenCalledWith(LIVE_DB_REFUSAL);
    expect(opener).not.toHaveBeenCalled();
    exit.mockRestore();
    error.mockRestore();
  });

  it('builds a throwaway database without opening the live database', async () => {
    const seen: string[] = [];
    const state = await createThrowaway(LIVE, LIVE, (url) => {
      seen.push(url);
      return Promise.resolve({
        query: (sql: string) => {
          if (sql.startsWith('CREATE DATABASE'))
            return Promise.resolve({ rows: [], rowCount: 0 });
          return Promise.reject(new Error(`unexpected ${sql}`));
        },
        end: () => Promise.resolve(undefined),
      });
    });
    expect(seen).toHaveLength(1);
    expect(databaseIdentity(seen[0])?.database).toBe('postgres');
    expect(databaseIdentity(state.testUrl)?.database).toBe(state.name);
    expect(state.kind).toBe('database');
    expect(state.name).toMatch(/^mc_test_[a-z0-9]+$/);
    expect(sameDatabase(state.testUrl, LIVE)).toBe(false);
  });

  it('falls back to a schema when create database is denied', async () => {
    const seen: string[] = [];
    const state = await createThrowaway(LIVE, LIVE, (url) => {
      seen.push(url);
      return Promise.resolve({
        query: (sql: string) => {
          if (sql.startsWith('CREATE DATABASE')) {
            const err = new Error(
              'permission denied to create database',
            ) as Error & {
              code: string;
            };
            err.code = '42501';
            return Promise.reject(err);
          }
          if (sql.startsWith('CREATE SCHEMA'))
            return Promise.resolve({ rows: [], rowCount: 0 });
          return Promise.reject(new Error(`unexpected ${sql}`));
        },
        end: () => Promise.resolve(undefined),
      });
    });
    expect(databaseIdentity(seen[0])?.database).toBe('postgres');
    expect(state.kind).toBe('schema');
    expect(state.testUrl).toContain('search_path');
    expect(state.testUrl).toContain(state.name);
    expect(databaseIdentity(state.testUrl)?.database).toBe('postgres');
    expect(sameDatabase(state.testUrl, LIVE)).toBe(false);
  });
});

describe('throwaway database lifecycle', () => {
  jest.setTimeout(120000);

  function serverUrl(): string {
    return (
      readState()?.adminUrl ||
      'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
    );
  }

  async function databaseExists(
    adminUrl: string,
    name: string,
  ): Promise<boolean> {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      const found = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [name],
      );
      return (found.rowCount ?? 0) > 0;
    } finally {
      await client.end();
    }
  }

  it('creates a throwaway database and drops it', async () => {
    const live =
      'postgresql://postgres:postgres@127.0.0.1:5432/mission_control';
    const created = await createThrowaway(serverUrl(), live);
    const file = join(mkdtempSync(join(tmpdir(), 'mc-drop-')), 'state.json');
    try {
      expect(created.kind).toBe('database');
      expect(await databaseExists(created.adminUrl, created.name)).toBe(true);
      const client = new Client({ connectionString: created.testUrl });
      await client.connect();
      try {
        const current = await client.query<{ name: string }>(
          'SELECT current_database() AS name',
        );
        expect(current.rows[0]?.name).toBe(created.name);
        await client.query('CREATE TABLE "IsolationProbe" (id text)');
        await client.query(`INSERT INTO "IsolationProbe" (id) VALUES ('row')`);
      } finally {
        await client.end();
      }
    } finally {
      writeFileSync(file, JSON.stringify(created));
      dropStateFile(file);
    }
    expect(await databaseExists(created.adminUrl, created.name)).toBe(false);
  });

  it('uses a schema when the login cannot create a database', async () => {
    const admin = new Client({ connectionString: serverUrl() });
    await admin.connect();
    const role = `mc_nodb_${randomBytes(4).toString('hex')}`;
    const password = 'mc_test_pw';
    let created: TestDbState | undefined;
    const file = join(mkdtempSync(join(tmpdir(), 'mc-schema-')), 'state.json');
    try {
      await admin.query(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB`,
      );
      await admin.query(
        `GRANT CONNECT, CREATE ON DATABASE postgres TO "${role}"`,
      );
      const limited = `postgresql://${role}:${password}@127.0.0.1:5432/mission_control`;
      created = await createThrowaway(limited, limited);
      expect(created.kind).toBe('schema');
      expect(sameDatabase(created.testUrl, limited)).toBe(false);
      const probe = new Client({ connectionString: created.testUrl });
      await probe.connect();
      try {
        const current = await probe.query<{ db: string; schema: string }>(
          'SELECT current_database() AS db, current_schema() AS schema',
        );
        expect(current.rows[0]?.db).toBe('postgres');
        expect(current.rows[0]?.schema).toBe(created.name);
      } finally {
        await probe.end();
      }
      const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: findApiDir(),
        env: {
          ...process.env,
          DATABASE_URL: created.testUrl,
          TEST_DATABASE_URL: created.testUrl,
        },
        encoding: 'utf8',
      });
      expect(migrated.status).toBe(0);
      const check = new Client({ connectionString: created.testUrl });
      await check.connect();
      try {
        const table = await check.query<{ reg: string | null }>(
          `SELECT to_regclass($1) AS reg`,
          [`${created.name}."Agent"`],
        );
        expect(table.rows[0]?.reg).toBeTruthy();
      } finally {
        await check.end();
      }
    } finally {
      if (created) {
        writeFileSync(file, JSON.stringify(created));
        dropStateFile(file);
      }
      const exists = await admin.query(
        'SELECT 1 FROM pg_roles WHERE rolname = $1',
        [role],
      );
      if ((exists.rowCount ?? 0) > 0) {
        await admin.query(`DROP OWNED BY "${role}" CASCADE`);
        await admin.query(`DROP ROLE "${role}"`);
      }
      await admin.end();
    }
  });
});
