import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * openclaw-log — shared, crash-proof access to the OpenClaw gateway log.
 *
 * Both LogsController (GET /logs) and SearchController (GET /search → logs
 * group) tail the newest `/tmp/openclaw/openclaw-<date>.log`. Ticket 2: on a
 * machine with NO OpenClaw (fresh clone, docker, demo seed) that directory
 * does not exist — and inside the api container it never does unless mounted.
 * That must render as a clean, explained empty state, never a 500.
 *
 * Contract: every filesystem call is wrapped. Missing dir, empty dir, a file
 * deleted between readdir and stat (log rotation race), or an unreadable file
 * all collapse to `{ available: false | true, file: null, lines: [] }` with a
 * human-readable `reason`. Nothing here ever throws.
 *
 * Read-only, loopback-trust-domain (same posture as before): we only ever
 * READ files under a fixed directory — no user input reaches the path.
 */

/** Fixed log location written by the OpenClaw gateway. Not user-controllable. */
export const OPENCLAW_LOG_DIR = '/tmp/openclaw';

/** One parsed log line, as rendered by the Logs page + search dropdown. */
export interface LogLine {
  tm: string;
  lvl: string;
  msg: string;
}

/** Result of a tail. `available=false` ⇒ no OpenClaw log source on this machine. */
export interface LogTail {
  /** True when a readable openclaw-*.log was found. */
  available: boolean;
  /** Absolute path of the file that was read (null when unavailable). */
  file: string | null;
  /** Raw (unparsed) lines, oldest → newest, already limited to `maxLines`. */
  lines: string[];
  /** Why there are no lines — shown verbatim by the UI empty state. */
  reason: string | null;
}

/**
 * Tail the newest OpenClaw gateway log. Never throws.
 * @param maxLines how many trailing lines to keep (caller clamps user input).
 */
export function tailNewestOpenclawLog(maxLines: number): LogTail {
  let candidates: string[];
  try {
    candidates = readdirSync(OPENCLAW_LOG_DIR).filter(
      (f) => f.startsWith('openclaw-') && f.endsWith('.log'),
    );
  } catch {
    // ENOENT (no OpenClaw on this box / inside docker) or EACCES — both are
    // "no log source", not a server error.
    return {
      available: false,
      file: null,
      lines: [],
      reason: `No OpenClaw gateway log found (${OPENCLAW_LOG_DIR} is missing). Connect OpenClaw via bridge/ to see live logs.`,
    };
  }

  // stat each candidate defensively: a rotated-away file must not crash the sort.
  const withMtime = candidates
    .map((f) => {
      const path = join(OPENCLAW_LOG_DIR, f);
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { path: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);

  const newest = withMtime[0]?.path ?? null;
  if (!newest) {
    return {
      available: false,
      file: null,
      lines: [],
      reason: `No openclaw-*.log files in ${OPENCLAW_LOG_DIR} yet.`,
    };
  }

  try {
    const lines = readFileSync(newest, 'utf8').split('\n').filter(Boolean).slice(-maxLines);
    return { available: true, file: newest, lines, reason: lines.length ? null : 'Log file is empty.' };
  } catch {
    return { available: false, file: null, lines: [], reason: `Could not read ${newest}.` };
  }
}

/**
 * Parse one gateway JSON-lines entry (`time`, `_meta.logLevelName`, `message`).
 * Non-JSON lines pass through as raw INFO text so format drift never breaks
 * the viewer. `maxLen` truncates the message (Logs page uses 300).
 */
export function parseLogLine(line: string, maxLen = Infinity): LogLine {
  try {
    const j = JSON.parse(line);
    const time = typeof j.time === 'string' ? j.time : '';
    return {
      tm: time ? time.slice(11, 19) : '',
      lvl: String(j._meta?.logLevelName ?? 'INFO'),
      msg: String(j.message ?? line).slice(0, maxLen),
    };
  } catch {
    return { tm: '', lvl: 'INFO', msg: line.slice(0, maxLen) };
  }
}
