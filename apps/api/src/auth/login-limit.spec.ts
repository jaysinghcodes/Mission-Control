import {
  DEFAULT_LOGIN_BACKOFF_MAX_SECONDS,
  DEFAULT_LOGIN_FAIL_LIMIT,
  DEFAULT_LOGIN_WINDOW_SECONDS,
  LOGIN_LIMIT_MESSAGE,
  loginBlock,
  loginLimitConfig,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginLimits,
} from './login-limit';

const IP = '203.0.113.9';
const OTHER = '203.0.113.10';

describe('login rate limit', () => {
  const env: NodeJS.ProcessEnv = {
    LOGIN_FAIL_LIMIT: '5',
    LOGIN_WINDOW_SECONDS: '60',
    LOGIN_BACKOFF_MAX_SECONDS: '900',
  };

  beforeEach(() => {
    resetLoginLimits();
  });

  it('uses the documented defaults when the env values are blank or invalid', () => {
    expect(loginLimitConfig({})).toEqual({
      limit: DEFAULT_LOGIN_FAIL_LIMIT,
      windowSeconds: DEFAULT_LOGIN_WINDOW_SECONDS,
      maxBackoffSeconds: DEFAULT_LOGIN_BACKOFF_MAX_SECONDS,
    });
    expect(
      loginLimitConfig({
        LOGIN_FAIL_LIMIT: '0',
        LOGIN_WINDOW_SECONDS: 'nope',
        LOGIN_BACKOFF_MAX_SECONDS: '-1',
      }),
    ).toEqual({
      limit: 5,
      windowSeconds: 60,
      maxBackoffSeconds: 900,
    });
    expect(LOGIN_LIMIT_MESSAGE).toBe('Too many tries. Try again in a minute.');
  });

  it('blocks the 6th try inside the window and allows it after the wait', () => {
    const start = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(loginBlock(IP, start + i)).toBeNull();
      recordLoginFailure(IP, env, start + i);
    }
    const lockedAt = start + 4;
    expect(loginBlock(IP, lockedAt)).toEqual({ retryAfter: 60 });
    expect(loginBlock(IP, lockedAt + 59_999)?.retryAfter).toBe(1);
    expect(loginBlock(IP, lockedAt + 60_000)).toBeNull();
    expect(loginBlock(OTHER, lockedAt)).toBeNull();
  });

  it('ignores failures that fall outside the window', () => {
    const start = 1_700_000_000_000;
    for (let i = 0; i < 4; i += 1) recordLoginFailure(IP, env, start);
    recordLoginFailure(IP, env, start + 60_001);
    for (let i = 0; i < 3; i += 1) {
      recordLoginFailure(IP, env, start + 60_001);
    }
    expect(loginBlock(IP, start + 60_001)).toBeNull();
    recordLoginFailure(IP, env, start + 60_001);
    expect(loginBlock(IP, start + 60_001)).toEqual({ retryAfter: 60 });
  });

  it('doubles the wait up to 15 minutes and a success starts over', () => {
    let now = 1_700_000_000_000;
    const waits = [60, 120, 240, 480, 900, 900];
    for (const wait of waits) {
      for (let i = 0; i < 5; i += 1) recordLoginFailure(IP, env, now);
      expect(loginBlock(IP, now)).toEqual({ retryAfter: wait });
      now += wait * 1000;
      expect(loginBlock(IP, now)).toBeNull();
    }
    recordLoginSuccess(IP);
    for (let i = 0; i < 5; i += 1) recordLoginFailure(IP, env, now);
    expect(loginBlock(IP, now)).toEqual({ retryAfter: 60 });
  });

  it('honors a shorter configured limit', () => {
    const tight: NodeJS.ProcessEnv = {
      LOGIN_FAIL_LIMIT: '2',
      LOGIN_WINDOW_SECONDS: '30',
      LOGIN_BACKOFF_MAX_SECONDS: '30',
    };
    const now = 50_000;
    recordLoginFailure(IP, tight, now);
    expect(loginBlock(IP, now)).toBeNull();
    recordLoginFailure(IP, tight, now);
    expect(loginBlock(IP, now)).toEqual({ retryAfter: 30 });
  });
});
