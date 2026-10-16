import { resetBundledPeerCache } from './bundled-proxy';
import {
  peerAddress,
  requestLoopback,
  sessionStatus,
  SHARED_REMOTE_BUCKET,
  trustedRemoteListener,
} from './session';

const NGINX = '172.18.0.4';
const OWNER = '172.18.0.1';

function call(
  peer: string,
  headers: Record<string, string> = {},
): {
  socket: { remoteAddress: string };
  headers: Record<string, string>;
} {
  return { socket: { remoteAddress: peer }, headers };
}

describe('socket loopback and the tunnel listener', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    resetBundledPeerCache();
  });

  it('does not treat a forwarded loopback address as loopback', () => {
    process.env.TRUSTED_PROXY = '10.0.0.8';
    delete process.env.BUNDLED_PROXY;
    resetBundledPeerCache();
    const req = call('10.0.0.8', {
      'x-forwarded-for': '127.0.0.1',
      'x-real-ip': '127.0.0.1',
    });
    expect(requestLoopback(req)).toBe(false);
    expect(sessionStatus(req)).toEqual({
      authenticated: false,
      loginRequired: true,
    });
    expect(peerAddress(req)).toBe('127.0.0.1');
  });

  it('keeps a real loopback socket open even when the header names someone else', () => {
    process.env.TRUSTED_PROXY = '127.0.0.1';
    delete process.env.BUNDLED_PROXY;
    resetBundledPeerCache();
    const req = call('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' });
    expect(requestLoopback(req)).toBe(true);
    expect(sessionStatus(req).loginRequired).toBe(false);
  });

  it('keys the tunnel listener by CF-Connecting-IP, then the first forwarded hop', () => {
    delete process.env.TRUSTED_PROXY;
    process.env.BUNDLED_PROXY = NGINX;
    resetBundledPeerCache();
    const cloudflare = call(NGINX, {
      'x-mc-remote': '1',
      'cf-connecting-ip': '203.0.113.10',
      'x-forwarded-for': `${OWNER}, 10.1.2.3`,
    });
    const tailscale = call(NGINX, {
      'x-mc-remote': '1',
      'x-forwarded-for': '198.51.100.8, 100.64.0.1',
    });
    const shared = call(NGINX, { 'x-mc-remote': '1' });
    const junk = call(NGINX, {
      'x-mc-remote': '1',
      'cf-connecting-ip': 'not-a-client',
      'x-forwarded-for': 'also-not',
    });
    expect(trustedRemoteListener(cloudflare)).toBe(true);
    expect(requestLoopback(cloudflare)).toBe(false);
    expect(requestLoopback(call('127.0.0.1', { 'x-mc-remote': '1' }))).toBe(
      true,
    );
    expect(peerAddress(cloudflare)).toBe('remote:203.0.113.10');
    expect(peerAddress(tailscale)).toBe('remote:198.51.100.8');
    expect(peerAddress(shared)).toBe(SHARED_REMOTE_BUCKET);
    expect(peerAddress(junk)).toBe(SHARED_REMOTE_BUCKET);
    expect(peerAddress(cloudflare)).not.toBe(OWNER);
    expect(
      peerAddress(
        call(NGINX, {
          'x-mc-remote': '1',
          'cf-connecting-ip': OWNER,
        }),
      ),
    ).toBe(`remote:${OWNER}`);
  });

  it('ignores a tunnel tag that did not come from the bundled proxy', () => {
    delete process.env.TRUSTED_PROXY;
    process.env.BUNDLED_PROXY = NGINX;
    resetBundledPeerCache();
    const spoof = call('203.0.113.40', {
      'x-mc-remote': '1',
      'cf-connecting-ip': '198.51.100.1',
      'x-forwarded-for': '127.0.0.1',
    });
    expect(trustedRemoteListener(spoof)).toBe(false);
    expect(requestLoopback(spoof)).toBe(false);
    expect(peerAddress(spoof)).toBe('203.0.113.40');
  });

  it('keeps the local listener on the owner address nginx recorded', () => {
    delete process.env.TRUSTED_PROXY;
    process.env.BUNDLED_PROXY = NGINX;
    resetBundledPeerCache();
    const owner = call(NGINX, {
      'x-forwarded-for': OWNER,
      'x-real-ip': '203.0.113.9',
      'x-mc-remote': '0',
    });
    expect(trustedRemoteListener(owner)).toBe(false);
    expect(requestLoopback(owner)).toBe(false);
    expect(peerAddress(owner)).toBe(OWNER);
  });
});
