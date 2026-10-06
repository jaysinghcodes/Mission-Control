/**
 * Sample mission and devices for `npm run seed:demo` (ticket 7).
 *
 * Fixed device ids so a second seed inserts nothing. `update: {}` in the
 * seed script leaves a mission you already edited, and a device you already
 * have, alone. Names are generic — no personal ids, no "Demo Builder".
 *
 * The offline laptop carries a last-seen offset. Online machines do not:
 * the page shows "Online" for them and a Chicago time for the other.
 */

export const DEMO_MISSION =
  'Ship an open-source mission control anyone can clone and run in five minutes.';

export interface DemoDevice {
  id: string;
  name: string;
  type: string;
  online: boolean;
  /** Minutes before seed time. Null while the device is online. */
  lastSeenMinAgo: number | null;
}

export const DEMO_DEVICES: DemoDevice[] = [
  { id: 'demo-device-studio', name: 'Studio display', type: 'browser', online: true, lastSeenMinAgo: null },
  { id: 'demo-device-api', name: 'API host', type: 'server', online: true, lastSeenMinAgo: null },
  { id: 'demo-device-field', name: 'Field laptop', type: 'laptop', online: false, lastSeenMinAgo: 180 },
];
