import { Injectable, Logger } from '@nestjs/common';

/**
 * GitHubService — merge PRs from Mission Control approvals.
 *
 * When the operator approves a kind='pr' approval, the ApprovalsController calls
 * merge() which merges the PR via the GitHub API and (standing rule #6)
 * deletes the source branch immediately. Token comes from GITHUB_TOKEN
 * (apps/api/.env, git-ignored).
 */
@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly token = process.env.GITHUB_TOKEN ?? '';

  private async gh(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
    if (!this.token) {
      return { ok: false, status: 0, data: { message: 'GITHUB_TOKEN not set' } };
    }
    try {
      const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'mission-control',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { message: String(e) } };
    }
  }

  /** Merge a PR and delete its source branch (standing rule #6). */
  async mergePr(repo: string, number: number, branch?: string | null): Promise<{ ok: boolean; message: string }> {
    const merge = await this.gh(`/repos/${repo}/pulls/${number}/merge`, 'PUT', {
      merge_method: 'merge',
      commit_title: `Merge PR #${number} (via Mission Control approval)`,
    });
    if (!merge.ok && merge.status !== 405) {
      return { ok: false, message: `merge failed: ${JSON.stringify(merge.data).slice(0, 160)}` };
    }
    // Branch delete is part of the standing workflow — best effort, non-fatal.
    if (branch) {
      await this.gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, 'DELETE');
    }
    return { ok: true, message: `merged PR #${number}${branch ? `, deleted branch ${branch}` : ''}` };
  }
}
