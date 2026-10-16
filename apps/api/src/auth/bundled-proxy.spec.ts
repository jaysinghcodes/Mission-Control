import { readFileSync } from 'node:fs';
import { clientAddress } from './client-address';
import {
  DEFAULT_BUNDLED_PROXY_HOST,
  bundledProxyTokens,
  currentBundledPeers,
  defaultComposePath,
  nginxServiceNames,
  refreshBundledPeers,
  resetBundledPeerCache,
} from './bundled-proxy';

describe('bundled nginx proxy', () => {
  afterEach(() => {
    resetBundledPeerCache();
  });

  it('reads the nginx service name from compose and not an address', () => {
    const text = readFileSync(defaultComposePath(), 'utf8');
    expect(nginxServiceNames(text)).toEqual([DEFAULT_BUNDLED_PROXY_HOST]);
    expect(text).toContain(
      `BUNDLED_PROXY: \${BUNDLED_PROXY:-${DEFAULT_BUNDLED_PROXY_HOST}}`,
    );
    expect(DEFAULT_BUNDLED_PROXY_HOST).not.toMatch(/^\d+\./);

    const renamed = [
      'services:',
      '  edge:',
      '    build:',
      '      dockerfile: apps/web/Dockerfile',
      '  api:',
      '    build:',
      '      dockerfile: apps/api/Dockerfile',
      'volumes:',
      '  mc-db:',
      '',
    ].join('\n');
    expect(nginxServiceNames(renamed)).toEqual(['edge']);
    expect(nginxServiceNames('services:\n  api:\n    image: api\n')).toEqual(
      [],
    );
  });

  it('uses the compose service under Compose and ignores it otherwise', () => {
    const compose = [
      'services:',
      '  edge:',
      '    build:',
      '      dockerfile: apps/web/Dockerfile',
      '',
    ].join('\n');
    expect(bundledProxyTokens({ MC_COMPOSE: '1' }, compose)).toEqual(['edge']);
    expect(bundledProxyTokens({ MC_COMPOSE: '1' }, 'services:\n')).toEqual([
      DEFAULT_BUNDLED_PROXY_HOST,
    ]);
    expect(bundledProxyTokens({}, compose)).toEqual([]);
    expect(
      bundledProxyTokens(
        { BUNDLED_PROXY: '10.1.2.3, web', MC_COMPOSE: '1' },
        compose,
      ),
    ).toEqual(['10.1.2.3', 'web']);
    expect(bundledProxyTokens({ BUNDLED_PROXY: '  ' })).toEqual([]);
  });

  it('resolves a hostname and trusts that peer', async () => {
    const peers = await refreshBundledPeers(
      { BUNDLED_PROXY: 'localhost', NODE_ENV: 'test' },
      true,
    );
    expect(peers.some((ip) => ip === '127.0.0.1' || ip === '::1')).toBe(true);
    const peer = peers[0];
    expect(
      clientAddress({
        remoteAddress: peer,
        forwardedFor: '203.0.113.8',
        bundledPeers: currentBundledPeers({ BUNDLED_PROXY: 'localhost' }),
      }),
    ).toBe('203.0.113.8');
    expect(
      clientAddress({
        remoteAddress: '203.0.113.9',
        forwardedFor: '198.51.100.9',
        bundledPeers: currentBundledPeers({ BUNDLED_PROXY: 'localhost' }),
      }),
    ).toBe('203.0.113.9');
  });

  it('warns once when the bundled hostname does not resolve', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = await refreshBundledPeers(
        { BUNDLED_PROXY: 'mc-bundled-proxy.invalid', NODE_ENV: 'development' },
        true,
      );
      const second = await refreshBundledPeers(
        { BUNDLED_PROXY: 'mc-bundled-proxy.invalid', NODE_ENV: 'development' },
        true,
      );
      expect(first).toEqual([]);
      expect(second).toEqual([]);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(
        lines.filter((line) => line.includes('mc-bundled-proxy.invalid')),
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
