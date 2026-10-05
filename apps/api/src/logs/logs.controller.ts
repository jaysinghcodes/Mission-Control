import { Controller, Get, Query } from '@nestjs/common';
import { parseLogLine, tailNewestOpenclawLog } from './openclaw-log';

/**
 * LogsController — REAL gateway log tail.
 *
 * Reads the newest /tmp/openclaw/openclaw-<date>.log (JSON-lines format with
 * _meta.logLevelName + message + time). Parse is defensive: non-JSON lines
 * pass through as raw text so the viewer never breaks on format drift.
 * Loopback-only API reading a local log file = same trust domain.
 *
 * Ticket 2 (no-OpenClaw machines): file access moved to `openclaw-log.ts`,
 * which never throws. When the log dir is missing the response is still 200
 * with `logs: []`, `available: false` and a `reason` string the Logs page
 * renders as a clean empty state (instead of a "waiting…"/error look).
 * Response shape is a strict superset of the old one (logs/file/ts kept).
 */
@Controller('logs')
export class LogsController {
  @Get()
  list(@Query('lines') lines = '200') {
    // Clamp user input: 1..500, default 200 (unchanged behavior).
    const n = Math.min(Math.max(Number(lines) || 200, 1), 500);
    const tail = tailNewestOpenclawLog(n);

    const logs = tail.lines
      .map((line) => parseLogLine(line, 300))
      .reverse(); // newest first

    return {
      logs,
      file: tail.file,
      // New (additive) fields for the empty state — old clients ignore them.
      available: tail.available,
      reason: tail.reason,
      ts: Date.now(),
    };
  }
}
