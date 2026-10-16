import {
  DASHBOARD_BIND_WARNING,
  evaluateDashboardBind,
  hashPassword,
  passwordMatches,
} from './password';

describe('dashboard password', () => {
  it('stores a scrypt hash and rejects a different password', () => {
    const hash = hashPassword('correct horse');
    expect(hash.startsWith('scrypt:16384:8:1:')).toBe(true);
    expect(hash).not.toContain('correct horse');
    expect(passwordMatches('correct horse', hash)).toBe(true);
    expect(passwordMatches('wrong', hash)).toBe(false);
    expect(passwordMatches('', hash)).toBe(false);
  });

  it('refuses a non loopback bind without a hash or session secret', () => {
    expect(evaluateDashboardBind({ HOST: '0.0.0.0' }).action).toBe('refuse');
    const hashOnly = evaluateDashboardBind({
      HOST: '0.0.0.0',
      DASHBOARD_PASSWORD_HASH: 'scrypt:16384:8:1:aa:bb',
    });
    expect(hashOnly.action).toBe('refuse');
    if (hashOnly.action === 'refuse') {
      expect(hashOnly.message).toContain('SESSION_SECRET');
      expect(hashOnly.message).not.toMatch(/[—–→]/);
    }
    expect(
      evaluateDashboardBind({
        HOST: '0.0.0.0',
        DASHBOARD_PASSWORD_HASH: 'scrypt:16384:8:1:aa:bb',
        SESSION_SECRET: 'secret',
      }).action,
    ).toBe('allow');
  });

  it('warns and stays open on loopback when no password is set', () => {
    expect(evaluateDashboardBind({ HOST: '127.0.0.1' })).toEqual({
      action: 'warn',
      message: DASHBOARD_BIND_WARNING,
    });
    expect(DASHBOARD_BIND_WARNING).not.toMatch(/[—–→]/);
  });
});
