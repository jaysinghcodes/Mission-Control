import { Controller, Get, Optional } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { probeGateway } from './gateway-probe';
import {
  configuredGatewayPort,
  gatewayMaxAgeMs,
  gatewayStatusFromProbe,
  gatewayStatusFromReport,
  usesBridgeReport,
  type GatewayReport,
  type GatewayStatus,
} from './gateway-status';

/**
 * SystemController. OS metrics for the machine that runs this API, plus
 * the OpenClaw gateway status.
 *
 * CPU, memory, and disk are measured on this request. Native installs probe
 * OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT (defaults 127.0.0.1 and
 * 18789). Under Compose, with the host blank, status comes from the latest
 * gateway.snapshot. An explicit host still probes that address.
 */
@Controller('system')
export class SystemController {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  @Get()
  async system() {
    const cores = os.cpus().length;
    const load = os.loadavg()[0];
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    let disk = { usedGb: 0, totalGb: 0, pct: 0 };
    try {
      const out = execFileSync('df', ['-kP', '/'], { encoding: 'utf8' });
      const line = out.split('\n')[1]?.trim().split(/\s+/);
      if (line && line.length >= 5) {
        const totalKb = Number(line[1]);
        const usedKb = Number(line[2]);
        disk = {
          totalGb: Math.round(totalKb / 1024 / 1024),
          usedGb: Math.round(usedKb / 1024 / 1024),
          pct: totalKb ? Math.round((usedKb / totalKb) * 100) : 0,
        };
      }
    } catch {
      // df unavailable. Leave zeros so the UI shows measured zeros.
    }

    const gateway = await this.gatewayStatus();

    return {
      cpu: {
        cores,
        model: os.cpus()[0]?.model ?? 'unknown',
        load1: Number(load.toFixed(2)),
        pct: Math.min(Math.round((load / cores) * 100), 100),
      },
      memory: {
        totalGb: Math.round(totalMem / 1024 ** 3),
        freeGb: Math.round(freeMem / 1024 ** 3),
        pct: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      disk,
      os: {
        platform: process.platform, // linux | darwin | win32
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        node: process.version,
      },
      gateway,
      uptimeSeconds: Math.round(os.uptime()),
      apiUptimeSeconds: Math.round(process.uptime()),
      ts: Date.now(),
    };
  }

  private async gatewayStatus(): Promise<GatewayStatus> {
    if (!usesBridgeReport(process.env)) {
      const probe = await probeGateway();
      return gatewayStatusFromProbe(probe, Date.now());
    }
    return gatewayStatusFromReport(
      await this.latestGatewayReport(),
      Date.now(),
      gatewayMaxAgeMs(process.env),
      configuredGatewayPort(process.env),
    );
  }

  private async latestGatewayReport(): Promise<GatewayReport | null> {
    if (!this.prisma) return null;
    try {
      const row = await this.prisma.activityEvent.findFirst({
        where: { type: 'gateway.snapshot' },
        orderBy: { ts: 'desc' },
        select: { payload: true },
      });
      const payload = row?.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return null;
      }
      return {
        up: payload.up,
        host: payload.host,
        port: payload.port,
        checkedAt: payload.checkedAt,
        latencyMs: payload.latencyMs,
        version: payload.version,
      };
    } catch {
      return null;
    }
  }
}
