import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadEnvFiles, readEnvFile } from './boot';

describe('boot env', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-boot-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads comments, quotes, and blank values', () => {
    const file = join(dir, '.env');
    writeFileSync(
      file,
      [
        '# comment',
        'export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mission_control',
        'INGEST_TOKEN=',
        'OPERATOR_NAME="Ada"',
        '',
      ].join('\n'),
    );
    expect(readEnvFile(file)).toEqual({
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5432/mission_control',
      INGEST_TOKEN: '',
      OPERATOR_NAME: 'Ada',
    });
  });

  it('lets apps/api/.env win and does not replace a blank process value', () => {
    const apiDir = join(dir, 'apps', 'api');
    const root = join(dir);
    writeFileSync(
      join(root, '.env'),
      'INGEST_TOKEN=from-root\nHOST=127.0.0.1\nPORT=3000\n',
    );
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, '.env'), 'INGEST_TOKEN=from-api\n');
    const env: NodeJS.ProcessEnv = { SOCKET_TOKEN: '' };
    const loaded = loadEnvFiles(apiDir, env);
    expect(loaded).toEqual([join(apiDir, '.env'), join(root, '.env')]);
    expect(env.INGEST_TOKEN).toBe('from-api');
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe('3000');
    expect(env.SOCKET_TOKEN).toBe('');
  });

  it('skips a missing file', () => {
    const apiDir = join(dir, 'apps', 'api');
    mkdirSync(apiDir, { recursive: true });
    const env: NodeJS.ProcessEnv = {};
    expect(loadEnvFiles(apiDir, env)).toEqual([]);
    expect(env.DATABASE_URL).toBeUndefined();
  });
});
