import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * App version and git SHA for GET /health and the System page.
 *
 * Version is `version` in apps/api/package.json.
 * The SHA is GIT_SHA when that variable is non empty, then apps/api/git-sha.txt
 * (the Docker image writes this file), then `git rev-parse HEAD` when this
 * process is inside a checkout. A missing SHA is null, not a placeholder.
 */

export interface BuildInfo {
  version: string;
  gitSha: string | null;
}

let cache: BuildInfo | null = null;

export function buildInfo(): BuildInfo {
  if (!cache) {
    const root = apiPackageRoot();
    cache = {
      version: readVersion(root),
      gitSha: readGitSha(process.env, root),
    };
  }
  return cache;
}

/** Tests change GIT_SHA or the sha file between calls. */
export function resetBuildInfoCache(): void {
  cache = null;
}

export function apiPackageRoot(start: string = __dirname): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (
          parsed &&
          typeof parsed === 'object' &&
          (parsed as { name?: unknown }).name === 'api'
        ) {
          return dir;
        }
      } catch {
        // Keep walking. A broken package.json is not this package.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(start);
}

export function readVersion(root: string): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    );
    if (parsed && typeof parsed === 'object') {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version.trim()) return version.trim();
    }
  } catch {
    // Fall through. The caller still gets a response.
  }
  return 'unknown';
}

export function readGitSha(
  env: NodeJS.ProcessEnv,
  root: string,
): string | null {
  const fromEnv = env.GIT_SHA?.trim() ?? '';
  if (fromEnv && !/\s/.test(fromEnv) && fromEnv.length <= 64) return fromEnv;
  const file = join(root, 'git-sha.txt');
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{7,64}$/i.test(text)) return text;
  }
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{7,64}$/i.test(sha)) return sha;
  } catch {
    return null;
  }
  return null;
}
