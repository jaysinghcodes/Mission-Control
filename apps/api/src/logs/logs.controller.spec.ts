import * as fs from 'fs';
import { LogsController } from './logs.controller';
import { SearchController } from '../search/search.controller';

/**
 * Ticket 2 — no-OpenClaw machines. /tmp/openclaw missing must yield clean,
 * explained empty states (200 + available:false), never a thrown error.
 * fs is mocked so the test is independent of the host's real /tmp/openclaw.
 */
// Only the three calls openclaw-log.ts makes are mocked; everything else in
// `fs` stays real (jest/ts-jest need it). fs exports are non-configurable, so
// they must be replaced in the module factory rather than via jest.spyOn.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
}));
const readdirSync = fs.readdirSync as unknown as jest.Mock;
const statSync = fs.statSync as unknown as jest.Mock;
const readFileSync = fs.readFileSync as unknown as jest.Mock;

const enoent = () => {
  throw Object.assign(
    new Error("ENOENT: no such file or directory, scandir '/tmp/openclaw'"),
    { code: 'ENOENT' },
  );
};

describe('OpenClaw log empty states (ticket 2)', () => {
  beforeEach(() => {
    readdirSync.mockReset();
    statSync.mockReset();
    readFileSync.mockReset();
  });

  it('GET /logs → empty, available:false, with a reason when /tmp/openclaw is missing', () => {
    readdirSync.mockImplementation(enoent);
    const res = new LogsController().list('200');
    expect(res.logs).toEqual([]);
    expect(res.file).toBeNull();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/\/tmp\/openclaw/);
  });

  it('GET /logs → available:false when the dir exists but has no openclaw-*.log', () => {
    readdirSync.mockReturnValue(['unrelated.txt']);
    const res = new LogsController().list('50');
    expect(res.logs).toEqual([]);
    expect(res.available).toBe(false);
  });

  it('GET /search → DB groups still returned, logs [] + logsAvailable:false', async () => {
    readdirSync.mockImplementation(enoent);
    const none = { findMany: jest.fn().mockResolvedValue([]) };
    const prisma = {
      run: none,
      ticket: none,
      agent: none,
      session: none,
      approval: none,
      activityEvent: none,
      // QA-1 polish item 8: the activity group now finds ids with a raw
      // ILIKE query (case-insensitive payload.name) before findMany.
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const res = await new SearchController(prisma as never).search('demo');
    expect(res.results.logs).toEqual([]);
    expect(res.logsAvailable).toBe(false);
    // The hint explains WHY logs are empty (no source), for the UI.
    expect(res.logsHint).toMatch(/\/tmp\/openclaw/);
  });

  it('GET /search → short query short-circuits without touching the log dir', async () => {
    const prisma = {};
    const res = await new SearchController(prisma as never).search('a');
    expect(res.results.logs).toEqual([]);
    expect(res.logsAvailable).toBeNull();
    expect(readdirSync).not.toHaveBeenCalled();
  });

  it('GET /logs → parses JSON lines newest-first when a log exists', () => {
    // Happy path guard: the refactor into openclaw-log.ts must not change
    // the existing response for machines that DO run OpenClaw.
    readdirSync.mockReturnValue(['openclaw-2026-10-04.log']);
    statSync.mockReturnValue({ mtimeMs: 1 });
    readFileSync.mockReturnValue(
      '{"time":"2026-10-04T10:00:01Z","_meta":{"logLevelName":"WARN"},"message":"first"}\nplain text line\n',
    );
    const res = new LogsController().list('10');
    expect(res.available).toBe(true);
    expect(res.reason).toBeNull();
    expect(res.logs).toEqual([
      { tm: '', lvl: 'INFO', msg: 'plain text line' },
      { tm: '10:00:01', lvl: 'WARN', msg: 'first' },
    ]);
  });
});
