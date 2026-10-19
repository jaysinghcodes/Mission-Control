import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { hostname, tmpdir, userInfo } from 'os';
import { join } from 'path';
import { Client } from 'pg';
import { findApiDir } from './boot';
import { currentStateFile, stateFileForRun } from './test-db-file';
import {
  LIVE_DB_REFUSAL,
  compareLiveDatabase,
  createThrowaway,
  databaseIdentity,
  decideTestDatabase,
  sameFingerprint,
  dropStateFile,
  pidAlive,
  prepareJestDatabase,
  readState,
  reapDeadTestDatabases,
  replaceDatabase,
  retargetConnection,
  rewriteHost,
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
    const customPort =
      'postgresql://postgres:postgres@127.0.0.1:5433/mission_control_test?sslmode=disable';
    expect(databaseIdentity(replaceDatabase(customPort, 'postgres'))).toEqual({
      host: 'loopback',
      port: '5433',
      database: 'postgres',
    });
    expect(
      retargetConnection(customPort, {
        user: 'mc_nodb_role',
        password: 'mc_test_pw',
        database: 'mission_control',
      }),
    ).toBe(
      'postgresql://mc_nodb_role:mc_test_pw@127.0.0.1:5433/mission_control?sslmode=disable',
    );
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

  it('refuses alias URLs when the server fingerprint matches', async () => {
    const seen: string[] = [];
    const opener = (url: string) => {
      seen.push(url);
      return Promise.resolve({
        query: (sql: string) => {
          if (!sql.includes('pg_control_system')) {
            return Promise.reject(new Error(`unexpected ${sql}`));
          }
          return Promise.resolve({
            rows: [
              {
                system_identifier: '99',
                database: 'mission_control',
                port: '5432',
              },
            ],
            rowCount: 1,
          });
        },
        end: () => Promise.resolve(undefined),
      });
    };
    const aliases = [
      'postgresql://postgres:postgres@0.0.0.0:5432/mission_control',
      'postgresql://postgres:postgres@cursor:5432/mission_control',
      'postgresql://postgres:postgres@db.invalid:5432/mission_control?host=127.0.0.1',
      'postgresql:///mission_control?host=/var/run/postgresql',
    ];
    for (const alias of aliases) {
      seen.length = 0;
      const exit = exitSpy();
      const error = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      await expect(
        prepareJestDatabase(
          { DATABASE_URL: LIVE, TEST_DATABASE_URL: alias },
          opener,
        ),
      ).rejects.toThrow('exit 1');
      expect(error).toHaveBeenCalledWith(LIVE_DB_REFUSAL);
      expect(seen).toEqual(expect.arrayContaining([alias, LIVE]));
      expect(sameDatabase(alias, LIVE)).toBe(false);
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('falls back when system_identifier is not permitted', async () => {
    const opener = () =>
      Promise.resolve({
        query: (sql: string) => {
          if (sql.includes('pg_control_system')) {
            const err = new Error(
              'permission denied for function pg_control_system',
            ) as Error & { code: string };
            err.code = '42501';
            return Promise.reject(err);
          }
          if (sql.includes('pg_postmaster_start_time')) {
            return Promise.resolve({
              rows: [
                {
                  started_at: new Date('2026-01-01T00:00:00.000Z'),
                  port: '5432',
                  database: 'mission_control',
                },
              ],
              rowCount: 1,
            });
          }
          return Promise.reject(new Error(`unexpected ${sql}`));
        },
        end: () => Promise.resolve(undefined),
      });
    const exit = exitSpy();
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await expect(
      prepareJestDatabase(
        {
          DATABASE_URL: LIVE,
          TEST_DATABASE_URL:
            'postgresql://postgres:postgres@0.0.0.0:5432/mission_control',
        },
        opener,
      ),
    ).rejects.toThrow('exit 1');
    expect(error).toHaveBeenCalledWith(LIVE_DB_REFUSAL);
    exit.mockRestore();
    error.mockRestore();
  });

  it('treats a different database name on the same server as safe', () => {
    expect(
      sameFingerprint(
        {
          systemIdentifier: '99',
          startedAt: '',
          port: '',
          database: 'mission_control',
        },
        {
          systemIdentifier: '99',
          startedAt: '',
          port: '',
          database: 'mc_test_abc',
        },
      ),
    ).toBe(false);
  });

  it('skips the identity check when DATABASE_URL cannot be reached', async () => {
    const testUrl =
      'postgresql://postgres:postgres@127.0.0.1:5432/mission_control_test';
    const liveUrl =
      'postgresql://postgres:postgres@127.0.0.1:1/mission_control';
    const opener = jest.fn((url: string) => {
      if (url === liveUrl) {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:1') as Error & {
          code: string;
        };
        err.code = 'ECONNREFUSED';
        return Promise.reject(err);
      }
      return Promise.reject(new Error(`unexpected connect ${url}`));
    });
    await expect(compareLiveDatabase(testUrl, liveUrl, opener)).resolves.toBe(
      'skipped',
    );
    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener).toHaveBeenCalledWith(liveUrl);
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

  function urlInUse(): string {
    const state = readState();
    const recorded = state?.adminUrl?.trim() || state?.testUrl?.trim();
    if (recorded) return recorded;
    const fromEnv =
      process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
    if (fromEnv) return fromEnv;
    throw new Error('No database URL is available to build a server URL.');
  }

  /** Maintenance connection on the host and port of the URL this run uses. */
  function serverUrl(): string {
    return replaceDatabase(urlInUse(), 'postgres');
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
    const server = serverUrl();
    const live = replaceDatabase(server, 'mission_control');
    const created = await createThrowaway(server, live);
    expect(databaseIdentity(created.testUrl)?.port).toBe(
      databaseIdentity(server)?.port,
    );
    expect(databaseIdentity(created.adminUrl)?.host).toBe(
      databaseIdentity(server)?.host,
    );
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
      const server = serverUrl();
      const limited = retargetConnection(server, {
        user: role,
        password,
        database: 'mission_control',
      });
      expect(databaseIdentity(limited)?.port).toBe(
        databaseIdentity(server)?.port,
      );
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

  it('drops a leftover database only when its owner is gone', async () => {
    const server = serverUrl();
    const live = replaceDatabase(server, 'mission_control');
    const kept = await createThrowaway(server, live);
    const gone = await createThrowaway(server, live);
    const ended = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = ended.pid ?? 0;
    const keepFile = stateFileForRun(
      process.pid,
      randomBytes(4).toString('hex'),
    );
    const deadFile = stateFileForRun(deadPid, randomBytes(4).toString('hex'));
    writeFileSync(
      keepFile,
      JSON.stringify({ ...kept, ownerPid: process.pid, disposable: true }),
    );
    writeFileSync(
      deadFile,
      JSON.stringify({ ...gone, ownerPid: deadPid, disposable: true }),
    );
    try {
      expect(pidAlive(process.pid)).toBe(true);
      expect(pidAlive(deadPid)).toBe(false);
      reapDeadTestDatabases();
      expect(await databaseExists(kept.adminUrl, kept.name)).toBe(true);
      expect(await databaseExists(gone.adminUrl, gone.name)).toBe(false);
      expect(readState(keepFile)?.dropped).toBeUndefined();
    } finally {
      dropStateFile(keepFile);
    }
  });

  it('two concurrent setups do not drop each other', async () => {
    const holdUrl = readState()?.testUrl?.trim() || serverUrl();
    const apiDir = findApiDir();
    const register = require.resolve('ts-node/register/transpile-only');
    const childSource = [
      'delete process.env.MC_TEST_DB_STATE_FILE;',
      "process.env.TEST_DATABASE_URL = '';",
      'process.env.DATABASE_URL = process.env.MC_HOLD_URL;',
      "const { prepareJestDatabase, readState, dropPreparedDatabase } = require('./src/test-database');",
      'prepareJestDatabase()',
      '  .then(() => {',
      '    const state = readState();',
      "    process.stdout.write(JSON.stringify({ name: state.name, adminUrl: state.adminUrl, file: process.env.MC_TEST_DB_STATE_FILE }) + '\\n');",
      '    const timer = setInterval(() => undefined, 1000);',
      '    const stop = () => {',
      '      clearInterval(timer);',
      '      try { dropPreparedDatabase(); } catch (err) { console.error(err); }',
      '      process.exit(0);',
      '    };',
      "    process.on('SIGTERM', stop);",
      '  })',
      '  .catch((err) => { console.error(err); process.exit(1); });',
    ].join('\n');

    function start(): ChildProcess {
      return spawn(process.execPath, ['-r', register, '-e', childSource], {
        cwd: apiDir,
        env: {
          ...process.env,
          MC_HOLD_URL: holdUrl,
          TEST_DATABASE_URL: '',
          MC_TEST_DB_STATE_FILE: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    function ready(
      child: ChildProcess,
    ): Promise<{ name: string; adminUrl: string; file: string }> {
      return new Promise((resolve, reject) => {
        let out = '';
        let err = '';
        let settled = false;
        child.stdout?.on('data', (buf: Buffer) => {
          out += buf.toString();
          const line = out.split('\n').find((row) => row.startsWith('{'));
          if (!line || settled) return;
          settled = true;
          resolve(
            JSON.parse(line) as {
              name: string;
              adminUrl: string;
              file: string;
            },
          );
        });
        child.stderr?.on('data', (buf: Buffer) => {
          err += buf.toString();
        });
        child.once('exit', (code) => {
          if (settled) return;
          reject(new Error(`setup exited ${code}\n${err}\n${out}`));
        });
      });
    }

    async function stop(child: ChildProcess): Promise<void> {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }

    const first = start();
    const second = start();
    try {
      const [left, right] = await Promise.all([ready(first), ready(second)]);
      expect(left.name).not.toBe(right.name);
      expect(await databaseExists(left.adminUrl, left.name)).toBe(true);
      expect(await databaseExists(right.adminUrl, right.name)).toBe(true);
      expect(await databaseExists(left.adminUrl, right.name)).toBe(true);
    } finally {
      await Promise.all([stop(first), stop(second)]);
    }
  }, 180000);

  it('refuses 0.0.0.0, the machine hostname, and a host query alias', async () => {
    const server = serverUrl();
    const direct = replaceDatabase(server, 'mc_alias_guard');
    const connectHost = new URL(server.replace(/^postgres(ql)?:/i, 'http:'))
      .hostname;
    const port = databaseIdentity(server)?.port || '5432';
    const socket =
      port === '5432'
        ? 'postgresql:///mc_alias_guard?host=/var/run/postgresql'
        : `postgresql:///mc_alias_guard?host=/var/run/postgresql&port=${port}`;
    const aliases = [
      rewriteHost(direct, '0.0.0.0'),
      rewriteHost(direct, hostname()),
      rewriteHost(direct, 'db.invalid', connectHost),
      socket,
    ];
    const admin = new Client({ connectionString: server });
    await admin.connect();
    const openGuard = async () => {
      const client = new Client({ connectionString: direct });
      await client.connect();
      return client;
    };
    let createdOsRole = false;
    let osUser = '';
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        ['mc_alias_guard'],
      );
      await admin.query('DROP DATABASE IF EXISTS mc_alias_guard');
      await admin.query('CREATE DATABASE mc_alias_guard');
      osUser = userInfo().username;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(osUser)) {
        throw new Error('refusing an unsafe operating system user name');
      }
      const roleExists = await admin.query(
        'SELECT 1 FROM pg_roles WHERE rolname = $1',
        [osUser],
      );
      createdOsRole = (roleExists.rowCount ?? 0) === 0;
      if (createdOsRole) await admin.query(`CREATE ROLE "${osUser}" LOGIN`);
      await admin.query(
        `GRANT CONNECT ON DATABASE mc_alias_guard TO "${osUser}"`,
      );
      const seed = await openGuard();
      try {
        await seed.query(
          'GRANT EXECUTE ON FUNCTION pg_control_system() TO PUBLIC',
        );
        await seed.query('CREATE TABLE qa_sentinel (id int primary key)');
        await seed.query('INSERT INTO qa_sentinel (id) VALUES (1)');
      } finally {
        await seed.end();
      }

      for (const alias of aliases) {
        expect(sameDatabase(alias, direct)).toBe(false);
        const exit = exitSpy();
        const error = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        await expect(
          prepareJestDatabase({
            DATABASE_URL: direct,
            TEST_DATABASE_URL: alias,
          }),
        ).rejects.toThrow('exit 1');
        expect(error).toHaveBeenCalledWith(LIVE_DB_REFUSAL);
        exit.mockRestore();
        error.mockRestore();
      }

      const check = await openGuard();
      try {
        const count = await check.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM qa_sentinel',
        );
        expect(count.rows[0]?.n).toBe(1);
        const migrated = await check.query<{ reg: string | null }>(
          `SELECT to_regclass('public."Agent"') AS reg`,
        );
        expect(migrated.rows[0]?.reg).toBeNull();
      } finally {
        await check.end();
      }
    } finally {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        ['mc_alias_guard'],
      );
      await admin.query('DROP DATABASE IF EXISTS mc_alias_guard');
      if (createdOsRole) await admin.query(`DROP ROLE "${osUser}"`);
      await admin.end();
    }
  });

  it('a login without superuser still refuses an alias', async () => {
    const server = serverUrl();
    const direct = replaceDatabase(server, 'mc_alias_guard');
    const role = `mc_nofinger_${randomBytes(3).toString('hex')}`;
    const password = 'mc_test_pw';
    const admin = new Client({ connectionString: server });
    await admin.connect();
    const guard = new Client({ connectionString: direct });
    let guardConnected = false;
    let roleReady = false;
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        ['mc_alias_guard'],
      );
      await admin.query('DROP DATABASE IF EXISTS mc_alias_guard');
      await admin.query('CREATE DATABASE mc_alias_guard');
      await admin.query(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER`,
      );
      roleReady = true;
      await admin.query(
        `GRANT CONNECT ON DATABASE mc_alias_guard TO "${role}"`,
      );
      // Function privileges live in the database being opened, not the maintenance database.
      await guard.connect();
      guardConnected = true;
      await guard.query(
        'REVOKE EXECUTE ON FUNCTION pg_control_system() FROM PUBLIC',
      );
      const limited = retargetConnection(direct, {
        user: role,
        password,
        database: 'mc_alias_guard',
      });
      const denied = new Client({ connectionString: limited });
      await denied.connect();
      try {
        const who = await denied.query<{ u: string }>(
          'SELECT current_user AS u',
        );
        expect(who.rows[0]?.u).toBe(role);
        await expect(
          denied.query('SELECT system_identifier FROM pg_control_system()'),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await denied.end();
      }
      await guard.query('CREATE TABLE qa_sentinel (id int primary key)');
      await guard.query('INSERT INTO qa_sentinel (id) VALUES (1)');

      const exit = exitSpy();
      const error = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      await expect(
        prepareJestDatabase({
          DATABASE_URL: limited,
          TEST_DATABASE_URL: rewriteHost(limited, '0.0.0.0'),
        }),
      ).rejects.toThrow('exit 1');
      expect(error).toHaveBeenCalledWith(LIVE_DB_REFUSAL);
      exit.mockRestore();
      error.mockRestore();

      const count = await guard.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM qa_sentinel',
      );
      expect(count.rows[0]?.n).toBe(1);
    } finally {
      if (guardConnected) {
        await guard.query(
          'GRANT EXECUTE ON FUNCTION pg_control_system() TO PUBLIC',
        );
        await guard.end();
      }
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        ['mc_alias_guard'],
      );
      await admin.query('DROP DATABASE IF EXISTS mc_alias_guard');
      if (roleReady) await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
    }
  });

  it('migrates the test database when DATABASE_URL is unreachable', async () => {
    const server = serverUrl();
    const skipUrl = replaceDatabase(server, 'mc_alias_skip');
    const stateFile = currentStateFile();
    const saved = readFileSync(stateFile, 'utf8');
    const admin = new Client({ connectionString: server });
    await admin.connect();
    try {
      await admin.query('DROP DATABASE IF EXISTS mc_alias_skip');
      await admin.query('CREATE DATABASE mc_alias_skip');
      const error = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      await prepareJestDatabase({
        DATABASE_URL:
          'postgresql://postgres:postgres@127.0.0.1:1/mission_control',
        TEST_DATABASE_URL: skipUrl,
      });
      expect(error).not.toHaveBeenCalledWith(LIVE_DB_REFUSAL);
      error.mockRestore();
      const check = new Client({ connectionString: skipUrl });
      await check.connect();
      try {
        const table = await check.query<{ reg: string | null }>(
          `SELECT to_regclass('public."Agent"') AS reg`,
        );
        expect(table.rows[0]?.reg).toBeTruthy();
      } finally {
        await check.end();
      }
    } finally {
      writeFileSync(stateFile, saved);
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        ['mc_alias_skip'],
      );
      await admin.query('DROP DATABASE IF EXISTS mc_alias_skip');
      await admin.end();
    }
  });
});
