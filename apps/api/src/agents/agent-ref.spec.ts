import { resolveIngestAgent, stampActivityAgent } from './agent-ref';

const roster = [
  { id: 'forge', name: 'Forge' },
  { id: 'quill', name: 'Quill' },
];

describe('resolveIngestAgent', () => {
  it('keeps an agent id and maps one display name', () => {
    expect(resolveIngestAgent('forge', roster)).toBe('forge');
    expect(resolveIngestAgent('Quill', roster)).toBe('quill');
    expect(resolveIngestAgent('  quill  ', roster)).toBe('quill');
  });

  it('leaves a shared display name and an unknown name unresolved', () => {
    const both = [...roster, { id: 'rogue', name: 'Forge' }];
    expect(resolveIngestAgent('Forge', both)).toBeNull();
    expect(resolveIngestAgent('forge', both)).toBe('forge');
    expect(resolveIngestAgent('rogue', both)).toBe('rogue');
    expect(resolveIngestAgent('Nobody', roster)).toBeNull();
    expect(resolveIngestAgent('  ', roster)).toBeNull();
  });
});

describe('stampActivityAgent', () => {
  it('stores the id on register and status even when agent is the display name', () => {
    expect(
      stampActivityAgent(
        { id: 'rogue', agent: 'Forge', action: 'register' },
        [...roster, { id: 'rogue', name: 'Forge' }],
        'agents.snapshot',
      ),
    ).toMatchObject({ agent: 'rogue' });
    expect(
      stampActivityAgent(
        { id: 'forge', agent: 'Forge', status: 'working' },
        roster,
        'agent.status',
      ),
    ).toMatchObject({ agent: 'forge' });
  });

  it('does not replace a run id, and resolves a unique name on the event', () => {
    const run = stampActivityAgent(
      { id: 'run-1', agent: 'Quill', name: 'Run started' },
      roster,
      'run.started',
    );
    expect(run.agent).toBe('quill');
    expect(run.id).toBe('run-1');

    const ambiguous = stampActivityAgent(
      { id: 'run-2', agent: 'Forge' },
      [...roster, { id: 'rogue', name: 'Forge' }],
      'run.running',
    );
    expect(ambiguous.agent).toBe('Forge');
  });
});
