import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The curl examples in section 4.10 are what Sentinel runs as written.
 * Dash punctuation here means em dash and en dash.
 */
describe('register docs', () => {
  const onboarding = readFileSync(
    join(__dirname, '../../../../docs/OPENCLAW_ONBOARDING.md'),
    'utf8',
  );
  const section = onboarding.split('### 4.10')[1]?.split('\n## 5.')[0] ?? '';

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
      'curl -sS -o /dev/null -w "%{http_code}\\n" -X DELETE "http://127.0.0.1:3000/agents/forge_helper"',
    );
    expect(section).toContain('x-ingest-token: $MC_TOKEN');
  });
});
