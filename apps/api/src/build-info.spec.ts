import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  apiPackageRoot,
  buildInfo,
  readGitSha,
  readVersion,
  resetBuildInfoCache,
} from './build-info';

describe('buildInfo', () => {
  const saved = process.env.GIT_SHA;

  afterEach(() => {
    if (saved === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = saved;
    resetBuildInfoCache();
  });

  it('matches package.json and the git checkout', () => {
    delete process.env.GIT_SHA;
    resetBuildInfoCache();
    const root = apiPackageRoot();
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const info = buildInfo();
    expect(info.version).toBe(readVersion(root));
    expect(info.version).not.toBe('unknown');
    expect(info.gitSha).toBe(sha);
  });

  it('prefers GIT_SHA over the checkout and over git-sha.txt', () => {
    process.env.GIT_SHA = 'abc1234';
    resetBuildInfoCache();
    expect(buildInfo().gitSha).toBe('abc1234');
    const dir = mkdtempSync(join(tmpdir(), 'mc-sha-'));
    try {
      writeFileSync(join(dir, 'git-sha.txt'), 'deadbeefcafebabe\n');
      expect(readGitSha({ GIT_SHA: 'abc1234' }, dir)).toBe('abc1234');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads git-sha.txt when the directory is not a checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-sha-'));
    try {
      writeFileSync(join(dir, 'git-sha.txt'), 'deadbeefcafebabe\n');
      expect(readGitSha({}, dir)).toBe('deadbeefcafebabe');
      writeFileSync(join(dir, 'git-sha.txt'), 'not a sha\n');
      expect(readGitSha({}, dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
