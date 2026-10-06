import { DEMO_DEVICES, DEMO_MISSION } from './demo-team';
import { MISSION_MAX } from './mission';

const SNOWFLAKE = /\d{17,21}/;

describe('seed team catalog', () => {
  it('has a sample mission and three devices', () => {
    expect(DEMO_MISSION.trim().length).toBeGreaterThan(0);
    expect(DEMO_MISSION.length).toBeLessThanOrEqual(MISSION_MAX);
    expect(DEMO_DEVICES).toHaveLength(3);

    const ids = new Set(DEMO_DEVICES.map((device) => device.id));
    expect(ids.size).toBe(3);

    const online = DEMO_DEVICES.filter((device) => device.online);
    const seen = DEMO_DEVICES.filter((device) => !device.online && device.lastSeenMinAgo != null);
    expect(online.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);

    for (const device of DEMO_DEVICES) {
      expect(device.id.startsWith('demo-device-')).toBe(true);
      expect(device.name.trim().length).toBeGreaterThan(0);
      expect(device.type.trim().length).toBeGreaterThan(0);
      expect(typeof device.online).toBe('boolean');
    }
  });

  it('does not ship personal ids or Demo Builder names', () => {
    const blob = JSON.stringify({ mission: DEMO_MISSION, devices: DEMO_DEVICES });
    expect(blob).not.toMatch(/Demo Builder/);
    expect(blob).not.toMatch(/discord/i);
    expect(blob).not.toMatch(SNOWFLAKE);
  });
});
