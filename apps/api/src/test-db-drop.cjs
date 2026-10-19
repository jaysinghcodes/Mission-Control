/**
 * Drops the throwaway database or schema recorded for npm test.
 *
 * node test-db-drop.cjs <stateFile> [--wait <pid>]
 *
 * Without --wait, drop immediately. With --wait, drop after that process
 * exits, unless the state file already says the database was dropped.
 * A successful drop removes the state file. A failure is best effort:
 * the next test run tries again.
 */
const { readFileSync, writeFileSync, existsSync, unlinkSync } = require('fs');
const { Client } = require('pg');

const NAME_RE = /^mc_test_[a-z0-9]+$/;

function readState(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function forgetStateFile(file) {
  try {
    unlinkSync(file);
  } catch {
    // Already gone, or the next run removes a file that is still here.
  }
}

async function dropState(state, file) {
  if (!state || !state.disposable) return;
  if (state.dropped) {
    forgetStateFile(file);
    return;
  }
  if (typeof state.name !== 'string' || !NAME_RE.test(state.name)) {
    throw new Error('refusing an unsafe test database name');
  }
  if (typeof state.adminUrl !== 'string' || !state.adminUrl.trim()) {
    throw new Error('refusing to drop a test database without an admin URL');
  }
  const client = new Client({ connectionString: state.adminUrl });
  await client.connect();
  try {
    if (state.kind === 'schema') {
      await client.query(`DROP SCHEMA IF EXISTS "${state.name}" CASCADE`);
    } else {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [state.name],
        );
        try {
          await client.query(`DROP DATABASE IF EXISTS "${state.name}"`);
          break;
        } catch (err) {
          if (attempt === 4) throw err;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }
  } finally {
    await client.end();
  }
  writeFileSync(file, JSON.stringify({ ...state, dropped: true }));
  forgetStateFile(file);
}

async function main() {
  const file = process.argv[2];
  if (!file) return;
  const waitFlag = process.argv.indexOf('--wait');
  const waitPid = waitFlag >= 0 ? Number(process.argv[waitFlag + 1]) : 0;
  if (waitPid) {
    const deadline = Date.now() + 60 * 60 * 1000;
    while (Date.now() < deadline) {
      const state = readState(file);
      if (!state || !state.disposable) return;
      if (state.dropped) {
        forgetStateFile(file);
        return;
      }
      if (state.ownerPid && state.ownerPid !== waitPid) return;
      if (!pidAlive(waitPid)) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  const state = readState(file);
  if (!state) return;
  if (waitPid && state.ownerPid && state.ownerPid !== waitPid) return;
  try {
    await dropState(state, file);
  } catch {
    // Best effort. A later run drops a leftover disposable database.
  }
}

if (require.main === module) {
  main();
}

module.exports = { dropState, readState };
