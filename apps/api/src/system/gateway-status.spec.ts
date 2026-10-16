import {
  DEFAULT_GATEWAY_MAX_AGE_MS,
  configuredGatewayPort,
  gatewayMaxAgeMs,
  gatewayStatusFromProbe,
  gatewayStatusFromReport,
  usesBridgeReport,
} from './gateway-status';

const NOW = 1_700_000_000_000;

describe('gateway status', () => {
  it('uses the bridge report only under Compose when the host is blank', () => {
    expect(usesBridgeReport({})).toBe(false);
    expect(usesBridgeReport({ MC_COMPOSE: '1' })).toBe(true);
    expect(
      usesBridgeReport({ MC_COMPOSE: '1', OPENCLAW_GATEWAY_HOST: '  ' }),
    ).toBe(true);
    expect(
      usesBridgeReport({
        MC_COMPOSE: '1',
        OPENCLAW_GATEWAY_HOST: 'not a host',
      }),
    ).toBe(true);
    expect(
      usesBridgeReport({ MC_COMPOSE: '1', OPENCLAW_GATEWAY_PORT: '19001' }),
    ).toBe(true);
    expect(
      usesBridgeReport({
        MC_COMPOSE: '1',
        OPENCLAW_GATEWAY_HOST: 'gateway.internal',
      }),
    ).toBe(false);
    expect(
      usesBridgeReport({
        MC_COMPOSE: '1',
        OPENCLAW_GATEWAY_HOST: 'gateway.internal',
        OPENCLAW_GATEWAY_PORT: '19001',
      }),
    ).toBe(false);
    expect(
      usesBridgeReport({ OPENCLAW_GATEWAY_HOST: 'gateway.internal' }),
    ).toBe(false);
  });

  it('keeps 10 minutes as the default max age and rejects blank, 0, and junk', () => {
    expect(DEFAULT_GATEWAY_MAX_AGE_MS).toBe(600000);
    expect(gatewayMaxAgeMs({})).toBe(600000);
    expect(gatewayMaxAgeMs({ GATEWAY_STATUS_MAX_AGE_MS: '' })).toBe(600000);
    expect(gatewayMaxAgeMs({ GATEWAY_STATUS_MAX_AGE_MS: '0' })).toBe(600000);
    expect(gatewayMaxAgeMs({ GATEWAY_STATUS_MAX_AGE_MS: 'nope' })).toBe(600000);
    expect(gatewayMaxAgeMs({ GATEWAY_STATUS_MAX_AGE_MS: '15000' })).toBe(15000);
  });

  it('reads an explicit port and otherwise uses 18789', () => {
    expect(configuredGatewayPort({})).toBe(18789);
    expect(configuredGatewayPort({ OPENCLAW_GATEWAY_PORT: '19001' })).toBe(
      19001,
    );
    expect(configuredGatewayPort({ OPENCLAW_GATEWAY_PORT: '0' })).toBe(18789);
  });

  it('shows Unknown when Compose has no report', () => {
    const status = gatewayStatusFromReport(null, NOW, 600000, 18789);
    expect(status.state).toBe('unknown');
    expect(status.up).toBe(false);
    expect(status.source).toBe('bridge');
    expect(status.host).toBe('127.0.0.1');
    expect(status.port).toBe(18789);
    expect(status.checkedAt).toBeNull();
  });

  it('shows Up and Down from a fresh bridge report, including a custom port', () => {
    const up = gatewayStatusFromReport(
      {
        up: true,
        host: '127.0.0.1',
        port: 19001,
        checkedAt: NOW - 1000,
        latencyMs: 4,
        version: 'OpenClaw 1',
      },
      NOW,
      600000,
      18789,
    );
    expect(up).toMatchObject({
      state: 'up',
      up: true,
      source: 'bridge',
      host: '127.0.0.1',
      port: 19001,
      latencyMs: 4,
      version: 'OpenClaw 1',
    });
    const down = gatewayStatusFromReport(
      { up: false, host: '127.0.0.1', port: 18789, checkedAt: NOW },
      NOW,
      600000,
      18789,
    );
    expect(down.state).toBe('down');
    expect(down.up).toBe(false);
    expect(down.latencyMs).toBeNull();
  });

  it('treats a report at the max age as fresh and an older one as Unknown', () => {
    const edge = gatewayStatusFromReport(
      { up: true, checkedAt: NOW - 600000, port: 18789 },
      NOW,
      600000,
      18789,
    );
    expect(edge.state).toBe('up');
    const stale = gatewayStatusFromReport(
      { up: false, checkedAt: NOW - 600001, port: 18789 },
      NOW,
      600000,
      18789,
    );
    expect(stale.state).toBe('unknown');
    expect(stale.up).toBe(false);
    expect(stale.checkedAt).toBe(NOW - 600001);
  });

  it('limits a future checkedAt to the time the API stored the report', () => {
    const freshSkew = gatewayStatusFromReport(
      {
        up: true,
        checkedAt: NOW + 86_400_000,
        port: 18789,
        receivedAt: NOW,
        latencyMs: 4,
      },
      NOW,
      600000,
      18789,
    );
    expect(freshSkew.state).toBe('up');
    expect(freshSkew.checkedAt).toBe(NOW + 86_400_000);

    const atLimit = gatewayStatusFromReport(
      {
        up: true,
        checkedAt: NOW + 86_400_000,
        port: 18789,
        receivedAt: NOW - 600000,
      },
      NOW,
      600000,
      18789,
    );
    expect(atLimit.state).toBe('up');

    const aged = gatewayStatusFromReport(
      {
        up: true,
        checkedAt: NOW + 86_400_000,
        port: 18789,
        receivedAt: NOW - 600001,
      },
      NOW,
      600000,
      18789,
    );
    expect(aged.state).toBe('unknown');
    expect(aged.up).toBe(false);
    expect(aged.checkedAt).toBe(NOW + 86_400_000);

    const normal = gatewayStatusFromReport(
      {
        up: true,
        checkedAt: NOW - 1000,
        port: 18789,
        receivedAt: NOW,
        latencyMs: 4,
      },
      NOW,
      600000,
      18789,
    );
    expect(normal).toMatchObject({
      state: 'up',
      up: true,
      checkedAt: NOW - 1000,
      latencyMs: 4,
    });

    const staleOnArrival = gatewayStatusFromReport(
      {
        up: true,
        checkedAt: NOW - 600001,
        port: 18789,
        receivedAt: NOW,
      },
      NOW,
      600000,
      18789,
    );
    expect(staleOnArrival.state).toBe('unknown');
    expect(staleOnArrival.checkedAt).toBe(NOW - 600001);
  });

  it('does not call a bad report Down', () => {
    expect(
      gatewayStatusFromReport({ up: 'yes', checkedAt: NOW }, NOW, 600000, 18789)
        .state,
    ).toBe('unknown');
    expect(
      gatewayStatusFromReport({ up: false }, NOW, 600000, 18789).state,
    ).toBe('unknown');
  });

  it('maps a direct probe to up or down and never to unknown', () => {
    expect(
      gatewayStatusFromProbe(
        { host: 'gateway.internal', port: 19001, up: true, latencyMs: 3 },
        NOW,
      ),
    ).toMatchObject({
      state: 'up',
      source: 'probe',
      host: 'gateway.internal',
      port: 19001,
    });
    expect(
      gatewayStatusFromProbe(
        { host: '127.0.0.1', port: 18789, up: false, latencyMs: null },
        NOW,
      ).state,
    ).toBe('down');
  });
});
