import { Controller, Get } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { probeGateway } from './gateway-probe';

/**
 * SystemController. OS metrics for the machine that runs this API, plus a
 * TCP probe of the configured OpenClaw gateway.
 *
 * CPU, memory, disk, and the gateway result are measured on this request.
 * The gateway target is OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT.
 * Outside Compose those default to 127.0.0.1 and 18789. Compose sets the
 * host default to host.docker.internal.
 */
@Controller('system')
export class SystemController {
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

    const gateway = await probeGateway();

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
}
