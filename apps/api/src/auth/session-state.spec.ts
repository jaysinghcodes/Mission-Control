import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { hashPassword } from './password';
import { signSession, validSession } from './session';
import {
  applyStoredPassword,
  changePasswordHash,
  readSessionState,
  revokeSessions,
} from './session-state';

describe('session state', () => {
  let dir: string;
  let savedPath: string | undefined;
  const secret = 'state-spec-secret';

  beforeEach(() => {
    savedPath = process.env.SESSION_STATE_PATH;
    dir = mkdtempSync(join(tmpdir(), 'mc-state-'));
    process.env.SESSION_STATE_PATH = join(dir, 'nested', 'state.json');
    process.env.SESSION_SECRET = secret;
    process.env.DASHBOARD_PASSWORD_HASH = hashPassword('original-password');
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.SESSION_STATE_PATH;
    else process.env.SESSION_STATE_PATH = savedPath;
    delete process.env.SESSION_SECRET;
    delete process.env.DASHBOARD_PASSWORD_HASH;
    rmSync(dir, { recursive: true, force: true });
  });

  function cookieFor(token: string): string {
    return `mc_session=${encodeURIComponent(token)}`;
  }

  it('rejects a copied cookie after revoke and still rejects it from the file', () => {
    const token = signSession(secret, 3600);
    const header = cookieFor(token);
    expect(validSession(header)).toBe(true);
    expect(revokeSessions()).toBe(2);
    expect(readSessionState().version).toBe(2);
    expect(validSession(header)).toBe(false);
    expect(
      (statSync(process.env.SESSION_STATE_PATH ?? '').mode & 0o777) === 0o600,
    ).toBe(true);
    const again = signSession(secret, 3600);
    expect(validSession(cookieFor(again))).toBe(true);
  });

  it('a password change revokes every cookie and replaces the hash', () => {
    const first = cookieFor(signSession(secret, 3600));
    const second = cookieFor(signSession(secret, 3600));
    const next = hashPassword('next-password');
    changePasswordHash(next);
    expect(validSession(first)).toBe(false);
    expect(validSession(second)).toBe(false);
    expect(process.env.DASHBOARD_PASSWORD_HASH).toBe(next);
    const env: NodeJS.ProcessEnv = {
      SESSION_STATE_PATH: process.env.SESSION_STATE_PATH,
      SESSION_SECRET: secret,
      DASHBOARD_PASSWORD_HASH: 'stale-from-env',
    };
    applyStoredPassword(env);
    expect(env.DASHBOARD_PASSWORD_HASH).toBe(next);
    expect(validSession(cookieFor(signSession(secret, 3600)))).toBe(true);
  });

  it('a broken state file matches no cookie', () => {
    const header = cookieFor(signSession(secret, 3600));
    expect(validSession(header)).toBe(true);
    const file = process.env.SESSION_STATE_PATH ?? '';
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'not json');
    expect(validSession(header)).toBe(false);
    expect(readSessionState().version).toBe(Number.MAX_SAFE_INTEGER);
  });
});
