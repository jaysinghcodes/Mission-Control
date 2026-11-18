/**
 * Who may move a ticket, and when the board is locked.
 *
 * The web mirror is apps/web/src/lib/board-lock.ts. Keep the two in step.
 * inprogress is the legacy alias of build.
 */

import { resolveIngestAgent, type AgentName } from '../agents/agent-ref';

export const SAMPLE_TICKET_IDS = [
  'demo-ticket-1',
  'demo-ticket-2',
  'demo-ticket-3',
  'demo-ticket-4',
  'demo-ticket-5',
  'demo-ticket-6',
  'demo-ticket-7',
  'demo-ticket-8',
] as const;

const SAMPLE_KEY = /^DEMO-\d+$/;

export const AGENTS_OWN_MESSAGE =
  'Agents move tickets past To Do. Turn on Manual moves in Settings to move it yourself.';

export const CREATE_IN_BACKLOG_MESSAGE =
  'New tickets start in Backlog while agents own the board. Move it to To Do when it is ready.';

export const SAMPLE_TICKET_MESSAGE = 'Sample tickets are moved by hand.';

export const CLAIM_FIELDS_MESSAGE = 'a claim sends status only';

export const ASSIGNEE_MESSAGE = 'assignee must be a registered agent id';

export const AGENTS_CANNOT_DELETE_MESSAGE =
  'Only the dashboard can delete a ticket.';

export const DELETE_OWNED_MESSAGE =
  'Agents own this ticket. Turn on Manual moves in Settings to delete it.';

export type BoardStage =
  'backlog' | 'todo' | 'build' | 'qa' | 'review' | 'done';

const AGENT_STAGES = new Set<BoardStage>(['build', 'qa', 'review', 'done']);
const HUMAN_STAGES = new Set<BoardStage>(['backlog', 'todo']);

/** Forward, then send back, in the order the refusal sentence lists them. */
const AGENT_TARGETS: Record<BoardStage, readonly BoardStage[]> = {
  backlog: [],
  todo: ['build'],
  build: ['qa', 'todo'],
  qa: ['review', 'build'],
  review: ['done', 'qa', 'build'],
  done: [],
};

const STAGE_LABEL: Record<BoardStage, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  build: 'Build',
  qa: 'QA',
  review: 'Review',
  done: 'Done',
};

export interface RosterAgent extends AgentName {
  source?: string | null;
}

export interface TicketSnapshot {
  id?: string | null;
  key?: string | null;
  status: string;
  assignee?: string | null;
}

export interface WriteFields {
  status?: string;
  assignee?: string;
  priority?: string;
  projectId?: string | null;
  title?: string;
  description?: string;
}

export interface WriteContext {
  mode: 'dashboard' | 'agent';
  actor?: string;
  operator: string;
  locked: boolean;
  /** Saved Manual moves. null is Automatic, true is On, false is Off. */
  manualMoves: boolean | null;
  registeredCount: number;
  roster: readonly RosterAgent[];
}

export type WritePlan =
  | { ok: true; fields: WriteFields; claim: boolean; override: boolean }
  | { ok: false; status: 400 | 403 | 409; body: Record<string, unknown> };

export function canonicalStage(status: string): BoardStage {
  const key = status.trim().toLowerCase();
  if (key === 'inprogress') return 'build';
  if (
    key === 'backlog' ||
    key === 'todo' ||
    key === 'build' ||
    key === 'qa' ||
    key === 'review' ||
    key === 'done'
  ) {
    return key;
  }
  return 'build';
}

export function isSampleTicket(ticket: {
  id?: string | null;
  key?: string | null;
}): boolean {
  const id = (ticket.id ?? '').trim();
  if ((SAMPLE_TICKET_IDS as readonly string[]).includes(id)) return true;
  return SAMPLE_KEY.test((ticket.key ?? '').trim());
}

/** null is Automatic. true unlocks. false locks. Automatic locks once someone is registered. */
export function boardIsLocked(
  manualMoves: boolean | null,
  registeredCount: number,
): boolean {
  if (manualMoves === true) return false;
  if (manualMoves === false) return true;
  return registeredCount > 0;
}

/**
 * The agent a stored assignee names, or null when any registered agent may claim.
 * The operator name, a blank, an unknown name, and a shared name do not stick.
 */
export function claimHolder(
  assignee: string | null | undefined,
  roster: readonly AgentName[],
  operator: string,
): string | null {
  const key = (assignee ?? '').trim();
  if (!key) return null;
  if (key === operator.trim()) return null;
  return resolveIngestAgent(key, roster);
}

export function claimableBy(
  assignee: string | null | undefined,
  actorId: string,
  roster: readonly AgentName[],
  operator: string,
): boolean {
  const holder = claimHolder(assignee, roster, operator);
  return holder === null || holder === actorId;
}

/** Unlocked, or a sample ticket: every status change a human can send today. */
export function humanMoveAllowed(
  from: string,
  to: string,
  locked: boolean,
  sample: boolean,
): boolean {
  if (!locked || sample) return true;
  if (canonicalStage(from) === canonicalStage(to)) return true;
  return (
    HUMAN_STAGES.has(canonicalStage(from)) &&
    HUMAN_STAGES.has(canonicalStage(to))
  );
}

/** The agent table in rule 6. A same stage write is not a move. */
export function agentMoveAllowed(from: string, to: string): boolean {
  const source = canonicalStage(from);
  const target = canonicalStage(to);
  if (source === target) return true;
  return AGENT_TARGETS[source].includes(target);
}

export function crossesAgentColumn(from: string, to: string): boolean {
  const source = canonicalStage(from);
  const target = canonicalStage(to);
  if (source === target) return false;
  return AGENT_STAGES.has(source) || AGENT_STAGES.has(target);
}

export function agentMoveMessage(from: string): string {
  const stage = canonicalStage(from);
  const list = AGENT_TARGETS[stage].map((item) => STAGE_LABEL[item]);
  const allowed = list.length > 0 ? list.join(', ') : 'none';
  return `An agent may move a ticket in ${STAGE_LABEL[stage]} to ${allowed}.`;
}

export function agentsOwnBody(): Record<string, unknown> {
  return {
    statusCode: 409,
    error: 'agents own this move',
    message: AGENTS_OWN_MESSAGE,
  };
}

export function createInBacklogBody(): Record<string, unknown> {
  return {
    statusCode: 409,
    error: 'create in backlog',
    message: CREATE_IN_BACKLOG_MESSAGE,
  };
}

export function notYourTicketBody(
  key: string,
  agentId: string,
): Record<string, unknown> {
  return {
    statusCode: 403,
    error: 'not your ticket',
    message: `${key} is assigned to ${agentId}.`,
  };
}

export function sampleTicketBody(): Record<string, unknown> {
  return {
    statusCode: 403,
    error: 'sample ticket',
    message: SAMPLE_TICKET_MESSAGE,
  };
}

export function alreadyClaimedBody(
  key: string,
  claimedBy: string,
): Record<string, unknown> {
  return {
    statusCode: 409,
    error: 'already claimed',
    claimedBy,
    message: `${key} was picked up by ${claimedBy}.`,
  };
}

export function moveNotAllowedBody(
  from: string,
  to: string,
): Record<string, unknown> {
  return {
    statusCode: 409,
    error: 'move not allowed',
    from,
    to,
    message: agentMoveMessage(from),
  };
}

function registeredId(id: string, roster: readonly RosterAgent[]): boolean {
  return roster.some((row) => row.id === id && row.source === 'registered');
}

function ticketKey(ticket: TicketSnapshot): string {
  const key = (ticket.key ?? '').trim();
  return key || 'Ticket';
}

/**
 * Decide a PATCH that already passed field validation.
 * Returns the fields to write. A refusal writes nothing.
 */
export function planTicketWrite(
  before: TicketSnapshot,
  fields: WriteFields,
  ctx: WriteContext,
): WritePlan {
  const next: WriteFields = { ...fields };
  const sample = isSampleTicket(before);
  const fromRaw = before.status;
  const from = canonicalStage(fromRaw);
  const statusSent = next.status !== undefined && next.status !== fromRaw;
  const key = ticketKey(before);

  if (ctx.mode === 'dashboard') {
    if (
      statusSent &&
      next.status !== undefined &&
      !humanMoveAllowed(fromRaw, next.status, ctx.locked, sample)
    ) {
      return { ok: false, status: 409, body: agentsOwnBody() };
    }
    const override =
      statusSent &&
      next.status !== undefined &&
      ctx.manualMoves === true &&
      ctx.registeredCount > 0 &&
      crossesAgentColumn(fromRaw, next.status);
    return { ok: true, fields: next, claim: false, override };
  }

  const actor = ctx.actor ?? '';
  if (sample) {
    return { ok: false, status: 403, body: sampleTicketBody() };
  }

  const to = next.status !== undefined ? canonicalStage(next.status) : null;
  const holder = claimHolder(before.assignee, ctx.roster, ctx.operator);
  const fieldNames = Object.keys(next);
  const statusOnly = next.status !== undefined && fieldNames.length === 1;
  const toBuild = to === 'build';

  if (from === 'todo' && toBuild) {
    if (!statusOnly) {
      return {
        ok: false,
        status: 400,
        body: { message: CLAIM_FIELDS_MESSAGE },
      };
    }
    if (holder && holder !== actor) {
      return { ok: false, status: 403, body: notYourTicketBody(key, holder) };
    }
    next.status = 'build';
    next.assignee = actor;
    return { ok: true, fields: next, claim: true, override: false };
  }

  if (statusOnly && toBuild && from === 'build') {
    if (holder === actor) {
      next.status = fromRaw;
      return { ok: true, fields: next, claim: false, override: false };
    }
    const claimedBy = holder || (before.assignee ?? '').trim() || 'nobody';
    return {
      ok: false,
      status: 409,
      body: alreadyClaimedBody(key, claimedBy),
    };
  }

  if (holder && holder !== actor) {
    return { ok: false, status: 403, body: notYourTicketBody(key, holder) };
  }

  if (next.assignee !== undefined && !registeredId(next.assignee, ctx.roster)) {
    return { ok: false, status: 400, body: { message: ASSIGNEE_MESSAGE } };
  }

  if (
    statusSent &&
    next.status !== undefined &&
    !agentMoveAllowed(fromRaw, next.status)
  ) {
    return {
      ok: false,
      status: 409,
      body: moveNotAllowedBody(fromRaw, next.status),
    };
  }

  if (!holder && (statusSent || next.assignee !== undefined)) {
    const assigned = holder || (before.assignee ?? '').trim() || 'nobody';
    return { ok: false, status: 403, body: notYourTicketBody(key, assigned) };
  }

  if (from === 'build' && to === 'todo') {
    next.assignee = ctx.operator;
    next.status = 'todo';
  }

  return { ok: true, fields: next, claim: false, override: false };
}

const HELD_STAGES = new Set<BoardStage>(['build', 'qa', 'review']);

export function agentsCannotDeleteBody(): Record<string, unknown> {
  return {
    statusCode: 403,
    error: 'agents cannot delete tickets',
    message: AGENTS_CANNOT_DELETE_MESSAGE,
  };
}

export function agentsOwnTicketBody(): Record<string, unknown> {
  return {
    statusCode: 409,
    error: 'agents own this ticket',
    message: DELETE_OWNED_MESSAGE,
  };
}

export type DeletePlan =
  | { ok: true; override: boolean }
  | { ok: false; status: 409; body: Record<string, unknown> };

/**
 * Decide a dashboard delete that already passed the actor check.
 * Sample tickets are always allowed. Build, QA, and Review wait for an
 * unlocked board. inprogress counts as Build.
 */
export function planTicketDelete(
  before: TicketSnapshot,
  ctx: {
    locked: boolean;
    manualMoves: boolean | null;
    registeredCount: number;
  },
): DeletePlan {
  const stage = canonicalStage(before.status);
  const held = HELD_STAGES.has(stage);
  const sample = isSampleTicket(before);
  if (held && ctx.locked && !sample) {
    return { ok: false, status: 409, body: agentsOwnTicketBody() };
  }
  const override = held && ctx.manualMoves === true && ctx.registeredCount > 0;
  return { ok: true, override };
}
