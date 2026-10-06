import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { GitHubService } from '../github/github.service';

/**
 * ApprovalsController — Review & Gate lane.
 *  - GET /approvals              → pending requests (synced via approvals.snapshot)
 *  - POST /approvals/:id/decide  → approve/reject; kind='pr' approvals are
 *    merged on GitHub (and branch deleted, standing rule #6) when approved
 */
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveActivityGateway,
    private readonly github: GitHubService,
  ) {}

  @Get()
  async list(@Query('status') status = 'pending') {
    // Default stays pending so existing clients are unchanged. `decided`
    // is the Approvals "Decided" tab (approved + rejected already stored).
    const where =
      status === 'decided'
        ? { status: { in: ['approved', 'rejected'] } }
        : status === 'all'
          ? {}
          : { status: 'pending' };
    const approvals = await this.prisma.approval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { approvals, ts: Date.now() };
  }

  @Post(':id/decide')
  async decide(@Param('id') id: string, @Body() body: { action?: 'approve' | 'reject' }) {
    const action = body?.action;
    if (action !== 'approve' && action !== 'reject') {
      return { error: 'action must be approve or reject' };
    }
    const existing = await this.prisma.approval.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'approval not found' };
    }

    // PR approvals: approving merges on GitHub + deletes the branch.
    let mergeResult: { ok: boolean; message: string } | null = null;
    if (action === 'approve' && existing.kind === 'pr') {
      const meta = (existing.meta ?? {}) as { repo?: string; number?: number; branch?: string | null };
      if (meta.repo && meta.number) {
        mergeResult = await this.github.mergePr(meta.repo, meta.number, meta.branch);
      } else {
        mergeResult = { ok: false, message: 'PR metadata missing — cannot merge on GitHub' };
      }
    }

    const approval = await this.prisma.approval.update({
      where: { id },
      data: { status: action === 'approve' ? 'approved' : 'rejected' },
    });
    this.gateway.broadcast('approval.decided', {
      id: approval.id,
      desc: approval.desc,
      action,
      status: approval.status,
      merge: mergeResult,
    });
    return { approval, merge: mergeResult, ts: Date.now() };
  }
}
