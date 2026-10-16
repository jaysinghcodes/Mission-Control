import {
  clientAddress,
  isLoopbackAddress,
  isTrustedProxyPeer,
} from './client-address';

describe('client address', () => {
  it('treats 127/8 and ::1 as loopback, including mapped ipv4', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.1.2.3')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('[::1]')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('0.0.0.0')).toBe(false);
    expect(isLoopbackAddress('::')).toBe(false);
    expect(isLoopbackAddress('10.0.0.8')).toBe(false);
    expect(isLoopbackAddress('172.18.0.3')).toBe(false);
  });

  it('uses the socket address and ignores X-Forwarded-For by default', () => {
    expect(
      clientAddress({
        remoteAddress: '::ffff:172.18.0.4',
        forwardedFor: '127.0.0.1',
      }),
    ).toBe('172.18.0.4');
    expect(
      clientAddress({
        remoteAddress: '10.1.2.3',
        forwardedFor: '127.0.0.1, 10.1.2.3',
        trustedProxies: '',
      }),
    ).toBe('10.1.2.3');
  });

  it('reads the client hop only when the socket peer is trusted', () => {
    expect(
      clientAddress({
        remoteAddress: '172.18.0.2',
        forwardedFor: '127.0.0.1, 203.0.113.8',
        trustedProxies: '172.18.0.2',
      }),
    ).toBe('203.0.113.8');
    expect(
      clientAddress({
        remoteAddress: '10.0.0.2',
        forwardedFor: '203.0.113.9, 10.0.0.2',
        trustedProxies: '10.0.0.0/8',
      }),
    ).toBe('203.0.113.9');
    expect(isTrustedProxyPeer('10.0.0.2', '10.0.0.0/8')).toBe(true);
    expect(isTrustedProxyPeer('11.0.0.2', '10.0.0.0/8')).toBe(false);
  });
});
