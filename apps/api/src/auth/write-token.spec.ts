import {
  WRITE_AUTH_WARNING,
  bindHost,
  configuredWriteToken,
  evaluateWriteBind,
  isLoopbackHost,
  tokensMatch,
} from './write-token';

describe('write token', () => {
  it('treats a missing or blank INGEST_TOKEN as unset', () => {
    expect(configuredWriteToken({})).toBeNull();
    expect(configuredWriteToken({ INGEST_TOKEN: '' })).toBeNull();
    expect(configuredWriteToken({ INGEST_TOKEN: '   ' })).toBeNull();
    expect(configuredWriteToken({ INGEST_TOKEN: 'change-me' })).toBe(
      'change-me',
    );
  });

  it('matches the header exactly and rejects a different length', () => {
    expect(tokensMatch('change-me', 'change-me')).toBe(true);
    expect(tokensMatch('change-me ', 'change-me')).toBe(false);
    expect(tokensMatch('change-m', 'change-me')).toBe(false);
    expect(tokensMatch(undefined, 'change-me')).toBe(false);
    expect(tokensMatch('other-value', 'change-me')).toBe(false);
  });

  it('defaults an unset HOST to loopback', () => {
    expect(bindHost({})).toBe('127.0.0.1');
    expect(bindHost({ HOST: '   ' })).toBe('127.0.0.1');
    expect(bindHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('treats 127/8, localhost, and ::1 as loopback', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('10.0.0.8')).toBe(false);
  });

  it('warns once on loopback when no token is set', () => {
    const decision = evaluateWriteBind({ HOST: '127.0.0.1' });
    expect(decision).toEqual({ action: 'warn', message: WRITE_AUTH_WARNING });
    expect(WRITE_AUTH_WARNING).toMatch(/unauthenticated/i);
    expect(WRITE_AUTH_WARNING).toMatch(/loopback/i);
    expect(WRITE_AUTH_WARNING).toMatch(/INGEST_TOKEN/);
  });

  it('allows any bind when a token is set', () => {
    expect(
      evaluateWriteBind({ HOST: '0.0.0.0', INGEST_TOKEN: 'change-me' }).action,
    ).toBe('allow');
  });

  it('refuses a non loopback bind when no token is set and says how to set one', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10']) {
      const decision = evaluateWriteBind({ HOST: host });
      expect(decision.action).toBe('refuse');
      if (decision.action !== 'refuse') continue;
      expect(decision.message).toContain(host);
      expect(decision.message).toContain('INGEST_TOKEN');
      expect(decision.message).toContain('openssl rand -hex 24');
      expect(decision.message).not.toMatch(/[—–]/);
    }
    expect(evaluateWriteBind({ HOST: '0.0.0.0', INGEST_TOKEN: '   ' }).action).toBe(
      'refuse',
    );
  });
});
