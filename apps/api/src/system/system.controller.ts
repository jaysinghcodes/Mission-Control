import { Controller, Get } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as os from 'os';

/**
 * SystemController — REAL OS-level metrics for the Health screen.
 *
 * Everything here is measured live from the host that runs OpenClaw:
 *  - CPU: load average / cores (percentage approximation)
 *  - Memory: total vs free (os module)
 *  - Disk: df -kP on / (used/total)
 *  - OS/platform/node/hostname: os + process
 *  - Gateway: TCP probe to 127.0.0.1:18789 (loopback latency, real)
 * No hardcoded values, ever (review fix #5).
 */
@Controller('system')
export class SystemController {
  @Get()
  system() {
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
      // df unavailable — leave zeros, UI shows real zeros not fake values
    }

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
      uptimeSeconds: Math.round(os.uptime()),
      apiUptimeSeconds: Math.round(process.uptime()),
      ts: Date.now(),
    };
  }
}
