import {
  AGENTS_OWN_MESSAGE,
  ASSIGNEE_MESSAGE,
  CLAIM_FIELDS_MESSAGE,
  CREATE_IN_BACKLOG_MESSAGE,
  SAMPLE_TICKET_MESSAGE,
  agentMoveAllowed,
  agentMoveMessage,
  boardIsLocked,
  claimableBy,
  humanMoveAllowed,
  isSampleTicket,
  planTicketWrite,
  type RosterAgent,
  type WriteContext,
  type WriteFields,
} from './move-rules';

const STATUSES = [
  'backlog',
  'todo',
  'build',
  'inprogress',
  'qa',
  'review',
  'done',
] as const;

const FORGE: RosterAgent = { id: 'forge', name: 'Forge', source: 'registered' };
const QUILL: RosterAgent = { id: 'quill', name: 'Quill', source: 'registered' };
const SNAP: RosterAgent = { id: 'snap_bot', name: 'Snap', source: 'snapshot' };
const SAMPLE: RosterAgent = { id: 'atlas', name: 'Atlas', source: 'default' };
const ROSTER = [
  FORGE,
  QUILL,
  SNAP,
  SAMPLE,
  { id: 'echo', name: 'Forge', source: 'registered' },
];

const OPERATOR = 'Operator';

function ctx(partial: Partial<WriteContext> = {}): WriteContext {
  return {
    mode: 'agent',
    actor: 'forge',
    operator: OPERATOR,
    locked: true,
    manualMoves: null,
    registeredCount: 1,
    roster: ROSTER,
    ...partial,
  };
}

function ticket(partial: {
  status: string;
  assignee?: string | null;
  id?: string;
  key?: string;
}) {
  return {
    id: partial.id ?? 'id-1',
    key: partial.key ?? 'MC-150',
    status: partial.status,
    assignee: partial.assignee ?? 'forge',
  };
}

describe('board lock', () => {
  it('follows the saved value, and Automatic follows the registered count', () => {
    expect(boardIsLocked(null, 0)).toBe(false);
    expect(boardIsLocked(null, 1)).toBe(true);
    expect(boardIsLocked(true, 4)).toBe(false);
    expect(boardIsLocked(false, 0)).toBe(true);
    expect(boardIsLocked(false, 3)).toBe(true);
  });
});

describe('sample tickets', () => {
  it('matches the seed ids and DEMO-n keys', () => {
    expect(isSampleTicket({ id: 'demo-ticket-1', key: 'DEMO-1' })).toBe(true);
    expect(isSampleTicket({ id: 'demo-ticket-8', key: 'MC-8' })).toBe(true);
    expect(isSampleTicket({ id: 'other', key: 'DEMO-9' })).toBe(true);
    expect(isSampleTicket({ id: 'other', key: 'MC-150' })).toBe(false);
    expect(isSampleTicket({ id: 'demo-ticket-9', key: 'DEMO-X' })).toBe(false);
  });
});

describe('human move matrix', () => {
  it('allows every pair when the board is unlocked or the ticket is a sample', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(humanMoveAllowed(from, to, false, false)).toBe(true);
        expect(humanMoveAllowed(from, to, true, true)).toBe(true);
      }
    }
  });

  it('while locked, allows backlog and todo only, and treats inprogress as build', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const fromStage = from === 'inprogress' ? 'build' : from;
        const toStage = to === 'inprogress' ? 'build' : to;
        const same = fromStage === toStage;
        const human =
          (fromStage === 'backlog' || fromStage === 'todo') &&
          (toStage === 'backlog' || toStage === 'todo');
        expect(humanMoveAllowed(from, to, true, false)).toBe(same || human);
      }
    }
  });
});

describe('agent move matrix', () => {
  it('allows one step forward, send back, release, and the claim, and treats inprogress as build', () => {
    const allowed: Record<string, string[]> = {
      backlog: ['backlog'],
      todo: ['todo', 'build', 'inprogress'],
      build: ['qa', 'todo', 'build', 'inprogress'],
      inprogress: ['qa', 'todo', 'build', 'inprogress'],
      qa: ['review', 'build', 'inprogress', 'qa'],
      review: ['done', 'qa', 'build', 'inprogress', 'review'],
      done: ['done'],
    };
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(agentMoveAllowed(from, to)).toBe(allowed[from].includes(to));
      }
    }
  });

  it('names the stages a holder may move to', () => {
    expect(agentMoveMessage('build')).toBe(
      'An agent may move a ticket in Build to QA, To Do.',
    );
    expect(agentMoveMessage('inprogress')).toBe(
      'An agent may move a ticket in Build to QA, To Do.',
    );
    expect(agentMoveMessage('qa')).toBe(
      'An agent may move a ticket in QA to Review, Build.',
    );
    expect(agentMoveMessage('review')).toBe(
      'An agent may move a ticket in Review to Done, QA, Build.',
    );
    expect(agentMoveMessage('todo')).toBe(
      'An agent may move a ticket in To Do to Build.',
    );
    expect(agentMoveMessage('done')).toBe(
      'An agent may move a ticket in Done to none.',
    );
    expect(agentMoveMessage('backlog')).toBe(
      'An agent may move a ticket in Backlog to none.',
    );
  });
});

describe('claimability', () => {
  const roster = ROSTER;

  it('keeps an id and a unique name, and opens the rest', () => {
    expect(claimableBy('forge', 'forge', roster, OPERATOR)).toBe(true);
    expect(claimableBy('quill', 'forge', roster, OPERATOR)).toBe(false);
    expect(claimableBy('Quill', 'quill', roster, OPERATOR)).toBe(true);
    expect(claimableBy('Quill', 'forge', roster, OPERATOR)).toBe(false);
    expect(claimableBy(OPERATOR, 'forge', roster, OPERATOR)).toBe(true);
    expect(claimableBy('Nobody', 'forge', roster, OPERATOR)).toBe(true);
    expect(claimableBy('Forge', 'forge', roster, OPERATOR)).toBe(true);
    expect(claimableBy('Forge', 'quill', roster, OPERATOR)).toBe(true);
    expect(claimableBy('', 'forge', roster, OPERATOR)).toBe(true);
    expect(claimableBy(null, 'forge', roster, OPERATOR)).toBe(true);
    expect(claimableBy('   ', 'quill', roster, OPERATOR)).toBe(true);
    expect(claimableBy('snap_bot', 'forge', roster, OPERATOR)).toBe(false);
  });
});

describe('planTicketWrite', () => {
  it('refuses a locked human move into an agent column and allows backlog and todo', () => {
    const locked = ctx({ mode: 'dashboard', actor: undefined, locked: true });
    const refused = planTicketWrite(
      ticket({ status: 'todo', assignee: OPERATOR }),
      { status: 'build' },
      locked,
    );
    expect(refused).toEqual({
      ok: false,
      status: 409,
      body: {
        statusCode: 409,
        error: 'agents own this move',
        message: AGENTS_OWN_MESSAGE,
      },
    });
    const back = planTicketWrite(
      ticket({ status: 'todo', assignee: OPERATOR }),
      { status: 'backlog' },
      locked,
    );
    expect(back.ok).toBe(true);
    const titled = planTicketWrite(
      ticket({ status: 'qa', assignee: 'forge' }),
      { title: 'Renamed' },
      locked,
    );
    expect(titled.ok).toBe(true);
  });

  it('lets a human move a sample ticket and logs an override only when Manual moves is On', () => {
    const sample = planTicketWrite(
      ticket({
        id: 'demo-ticket-3',
        key: 'DEMO-3',
        status: 'build',
        assignee: 'atlas',
      }),
      { status: 'qa' },
      ctx({ mode: 'dashboard', actor: undefined, locked: true }),
    );
    expect(sample.ok).toBe(true);
    if (!sample.ok) return;
    expect(sample.override).toBe(false);

    const override = planTicketWrite(
      ticket({ status: 'build', assignee: 'forge' }),
      { status: 'qa' },
      ctx({
        mode: 'dashboard',
        actor: undefined,
        locked: false,
        manualMoves: true,
        registeredCount: 1,
      }),
    );
    expect(override.ok).toBe(true);
    if (!override.ok) return;
    expect(override.override).toBe(true);

    const open = planTicketWrite(
      ticket({ status: 'build', assignee: 'forge' }),
      { status: 'qa' },
      ctx({
        mode: 'dashboard',
        actor: undefined,
        locked: false,
        manualMoves: true,
        registeredCount: 0,
      }),
    );
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.override).toBe(false);
  });

  it('claims with status only, stamps the actor, and refuses extra fields', () => {
    const claim = planTicketWrite(
      ticket({ status: 'todo', assignee: OPERATOR }),
      { status: 'build' },
      ctx(),
    );
    expect(claim).toEqual({
      ok: true,
      fields: { status: 'build', assignee: 'forge' },
      claim: true,
      override: false,
    });
    const extra = planTicketWrite(
      ticket({ status: 'todo', assignee: OPERATOR }),
      { status: 'build', title: 'Nope' },
      ctx(),
    );
    expect(extra).toEqual({
      ok: false,
      status: 400,
      body: { message: CLAIM_FIELDS_MESSAGE },
    });
    const reserved = planTicketWrite(
      ticket({ status: 'todo', assignee: 'quill' }),
      { status: 'build' },
      ctx(),
    );
    expect(reserved.ok).toBe(false);
    if (reserved.ok) return;
    expect(reserved.status).toBe(403);
    expect(reserved.body).toEqual({
      statusCode: 403,
      error: 'not your ticket',
      message: 'MC-150 is assigned to quill.',
    });
  });

  it('treats a repeated claim as a no op and a second agent as already claimed', () => {
    const again = planTicketWrite(
      ticket({ status: 'build', assignee: 'forge' }),
      { status: 'build' },
      ctx(),
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.fields.status).toBe('build');
    expect(again.claim).toBe(false);

    const lost = planTicketWrite(
      ticket({ status: 'build', assignee: 'forge' }),
      { status: 'build' },
      ctx({ actor: 'quill' }),
    );
    expect(lost).toEqual({
      ok: false,
      status: 409,
      body: {
        statusCode: 409,
        error: 'already claimed',
        claimedBy: 'forge',
        message: 'MC-150 was picked up by forge.',
      },
    });
  });

  it('lets the holder step, send back, release, and hand off', () => {
    const cases: {
      from: string;
      fields: WriteFields;
      status: string;
      assignee: string;
    }[] = [
      {
        from: 'build',
        fields: { status: 'qa' },
        status: 'qa',
        assignee: 'forge',
      },
      {
        from: 'qa',
        fields: { status: 'review' },
        status: 'review',
        assignee: 'forge',
      },
      {
        from: 'review',
        fields: { status: 'done' },
        status: 'done',
        assignee: 'forge',
      },
      {
        from: 'qa',
        fields: { status: 'build' },
        status: 'build',
        assignee: 'forge',
      },
      {
        from: 'review',
        fields: { status: 'qa' },
        status: 'qa',
        assignee: 'forge',
      },
      {
        from: 'review',
        fields: { status: 'build' },
        status: 'build',
        assignee: 'forge',
      },
      {
        from: 'inprogress',
        fields: { status: 'qa' },
        status: 'qa',
        assignee: 'forge',
      },
      {
        from: 'build',
        fields: { status: 'todo' },
        status: 'todo',
        assignee: OPERATOR,
      },
      {
        from: 'build',
        fields: { status: 'qa', assignee: 'quill' },
        status: 'qa',
        assignee: 'quill',
      },
      {
        from: 'qa',
        fields: { assignee: 'quill' },
        status: 'qa',
        assignee: 'quill',
      },
    ];
    for (const item of cases) {
      const plan = planTicketWrite(
        ticket({ status: item.from, assignee: 'forge' }),
        item.fields,
        ctx(),
      );
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      expect(plan.fields.status ?? item.from).toBe(item.status);
      expect(plan.fields.assignee ?? 'forge').toBe(item.assignee);
      expect(plan.claim).toBe(false);
    }
  });

  it('refuses skips, backlog, done, another holder, a sample, and a bad assignee', () => {
    const skip = planTicketWrite(
      ticket({ status: 'build' }),
      { status: 'review' },
      ctx(),
    );
    expect(skip.ok).toBe(false);
    if (!skip.ok) {
      expect(skip.status).toBe(409);
      expect(skip.body).toMatchObject({
        error: 'move not allowed',
        from: 'build',
        to: 'review',
      });
    }
    const backlog = planTicketWrite(
      ticket({ status: 'backlog', assignee: OPERATOR }),
      { status: 'build' },
      ctx(),
    );
    expect(backlog.ok).toBe(false);
    if (!backlog.ok)
      expect(backlog.body).toMatchObject({ error: 'move not allowed' });

    const done = planTicketWrite(
      ticket({ status: 'done' }),
      { status: 'review' },
      ctx(),
    );
    expect(done.ok).toBe(false);

    const other = planTicketWrite(
      ticket({ status: 'qa', assignee: 'quill' }),
      { status: 'review' },
      ctx(),
    );
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.status).toBe(403);

    const sample = planTicketWrite(
      ticket({
        id: 'demo-ticket-1',
        key: 'DEMO-1',
        status: 'todo',
        assignee: 'forge',
      }),
      { status: 'build' },
      ctx(),
    );
    expect(sample).toEqual({
      ok: false,
      status: 403,
      body: {
        statusCode: 403,
        error: 'sample ticket',
        message: SAMPLE_TICKET_MESSAGE,
      },
    });

    const bad = planTicketWrite(
      ticket({ status: 'build' }),
      { assignee: 'Snap' },
      ctx(),
    );
    expect(bad).toEqual({
      ok: false,
      status: 400,
      body: { message: ASSIGNEE_MESSAGE },
    });
  });

  it('keeps the create in backlog sentence exact', () => {
    expect(CREATE_IN_BACKLOG_MESSAGE).toBe(
      'New tickets start in Backlog while agents own the board. Move it to To Do when it is ready.',
    );
  });
});
