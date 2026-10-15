import {
  activityText,
  agentRegistered,
  agentStatusName,
  agentWentOffline,
  plainActivity,
  runActivityName,
  stageName,
  ticketCreated,
  ticketMoved,
  ticketUpdated,
} from './activity-text';

const ARROW = /[→←]/;

describe('activity text', () => {
  it('names a ticket move with a capitalized stage', () => {
    expect(ticketMoved('MC-151', 'build')).toBe('MC-151 moved to Build');
    expect(ticketMoved('MC-151', 'qa')).toBe('MC-151 moved to QA');
    expect(ticketMoved('MC-151', 'inprogress')).toBe('MC-151 moved to Build');
    expect(ticketMoved('DEMO-1', 'todo')).toBe('DEMO-1 moved to To Do');
    expect(ticketMoved('DEMO-5', 'review')).toBe('DEMO-5 moved to Review');
    expect(ticketMoved('DEMO-6', 'done')).toBe('DEMO-6 moved to Done');
    expect(ticketMoved('DEMO-7', 'backlog')).toBe('DEMO-7 moved to Backlog');
    expect(ticketCreated('MC-151')).toBe('MC-151 created');
    expect(ticketUpdated('MC-151')).toBe('MC-151 updated');
  });

  it('names runs and agent status in plain words', () => {
    expect(runActivityName('running')).toBe('Run started');
    expect(runActivityName('done')).toBe('Run finished');
    expect(runActivityName('failed')).toBe('Run failed');
    expect(runActivityName('needs_approval')).toBe('Run needs you');
    expect(runActivityName('queued')).toBe('Run queued');
    expect(agentStatusName('Forge', 'working')).toBe('Forge is now working');
    expect(agentStatusName('Forge', 'idle')).toBe('Forge is now idle');
    expect(agentRegistered('Live Quill')).toBe('Live Quill registered');
    expect(agentWentOffline('Live Quill')).toBe('Live Quill went offline');
  });

  it('rewrites a stored arrow line and never leaves an arrow', () => {
    expect(activityText({ name: 'ticket MC-151 → build' })).toBe(
      'MC-151 moved to Build',
    );
    expect(plainActivity('MC-9 → qa')).toBe('MC-9 moved to QA');
    const lines = [
      ticketMoved('MC-151', 'build'),
      ticketCreated('MC-151'),
      ticketUpdated('MC-151'),
      runActivityName('running'),
      agentStatusName('Forge', 'working'),
      agentRegistered('Live Quill'),
      agentWentOffline('Live Quill'),
      activityText({ name: 'ticket MC-151 → build' }),
      activityText({ name: 'Run started' }),
      activityText({ name: 'Forge is now working' }),
      activityText({ summary: 'left ← right' }),
      stageName('qa'),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(ARROW);
    }
  });
});
