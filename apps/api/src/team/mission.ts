import { BadRequestException } from '@nestjs/common';

/**
 * Team mission (ticket 7).
 *
 * One Setting row, id "default". Empty is a real saved value: GET returns
 * `mission: ""` plus `placeholder`, and the page shows the placeholder.
 * A missing row is the same shape — nothing has been saved yet.
 *
 * Too-long and non-string bodies are 400. The handler never returns 200
 * with an `{ error }` body.
 */

/** Stored text, after trim. Long enough for a wrapping paragraph. */
export const MISSION_MAX = 2000;

export const SETTING_ID = 'default';

/** Shown on the Team page when the saved mission is empty. */
export const MISSION_PLACEHOLDER = 'No mission yet. Edit to add one the team can see.';

export interface MissionBody {
  mission: string;
  placeholder: string;
  ts: number;
}

export function missionResponse(mission: string): MissionBody {
  return { mission, placeholder: MISSION_PLACEHOLDER, ts: Date.now() };
}

/**
 * Read a PUT /mission body. Returns the trimmed text to store.
 * Empty (including whitespace-only) is valid and means "show the placeholder".
 */
export function readMission(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('mission is required');
  }
  const mission = (body as { mission?: unknown }).mission;
  if (typeof mission !== 'string') {
    throw new BadRequestException('mission must be a string');
  }
  const text = mission.trim();
  if (text.length > MISSION_MAX) {
    throw new BadRequestException(`mission must be at most ${MISSION_MAX} characters`);
  }
  return text;
}
