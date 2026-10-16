import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The curl examples in section 4.10 of docs/API.md are what Sentinel runs as written.
 * Dash punctuation here means em dash and en dash.
 */
describe('register docs', () => {
  const apiDoc = readFileSync(
    join(__dirname, '../../../../docs/API.md'),
    'utf8',
  );
  const section = apiDoc.split('### 4.10')[1]?.split('\n## 5.')[0] ?? '';

  it('has curl examples for register, heartbeat, and delete with no dash punctuation', () => {
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
    expect(section).toContain(
      'curl -sS -D - -o /tmp/mc-register.json -X POST "http://127.0.0.1:3000/agents/register"',
    );
    expect(section).toContain(
      `'{"id":"forge_helper","name":"Forge Helper","role":"engineer"}'`,
    );
    expect(section).toContain(
      `'{"id":"forge_helper","name":"Forge Helper","role":"engineer","model":"local"}'`,
    );
    expect(section).toContain(
      'curl -sS -o /dev/null -w "%{http_code}\\n" -X POST "http://127.0.0.1:3000/agents/forge_helper/heartbeat"',
    );
    expect(section).toContain(
      `'{"currentTask":"Shipping the notes","status":"working"}'`,
    );
    expect(section).toContain(`'{"status":"idle"}'`);
    expect(section).toContain(`'{"currentTask":null}'`);
    expect(section).toContain(`'{"currentTask":""}'`);
    expect(section).toContain('clears `currentTask`');
    expect(section).toContain('Commons subtitle is Idle');
    expect(section).toContain('status must be one of working, idle');
    expect(section).toContain('unknown field <name>');
    expect(section).toContain(
      'curl -sS -o /dev/null -w "%{http_code}\\n" -X DELETE "http://127.0.0.1:3000/agents/forge_helper"',
    );
    expect(section).toContain('x-ingest-token: $MC_TOKEN');
  });

  it('documents optional run status and curls that create queued, create running, and patch', () => {
    const section = apiDoc.split('### 4.6')[1]?.split('\n### 4.7')[0] ?? '';
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
    expect(section).not.toContain('create does not accept');
    expect(section).toContain(
      'status must be one of queued, running, done, failed, needs_approval',
    );
    expect(section).toContain(
      'curl -sS -D - -o /tmp/mc-run.json -X POST "http://127.0.0.1:3000/runs"',
    );
    expect(section).toContain(`'{"name":"Onboarding run","status":"running"}'`);
    expect(section).toContain(`'{"name":"Queued onboarding run"}'`);
    expect(section).toContain('PATCH "http://127.0.0.1:3000/runs/$RUN_ID"');
    expect(apiDoc).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });
});
