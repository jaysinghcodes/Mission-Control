import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Dashboard device writes (ticket 150).
 *
 * POST /devices takes `{ name, type }` and nothing else. The API picks the
 * id. The row is `source` manual, offline, paired now, and never seen.
 * devices.snapshot leaves manual rows alone, so a bridge report cannot
 * delete or overwrite one.
 */

export const DEVICE_TYPES = [
  'browser',
  'server',
  'laptop',
  'phone',
  'other',
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_NAME_MAX = 80;

export const MANUAL_SOURCE = 'manual';

const CREATE_FIELDS = new Set(['name', 'type']);

export interface DeviceInput {
  name: string;
  type: DeviceType;
}

/** Read a POST /devices body. Unknown fields, a bad name, or a bad type are 400. */
export function readDeviceInput(body: unknown): DeviceInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('name is required');
  }
  const payload = body as Record<string, unknown>;
  const unknown = Object.keys(payload).filter((key) => !CREATE_FIELDS.has(key));
  if (unknown.length > 0) {
    const label = unknown.length === 1 ? 'unknown field' : 'unknown fields';
    throw new BadRequestException(`${label} ${unknown.join(', ')}`);
  }
  if (payload.name === undefined || payload.name === null) {
    throw new BadRequestException('name is required');
  }
  if (typeof payload.name !== 'string') {
    throw new BadRequestException('name must be a string');
  }
  const name = payload.name.replaceAll('\0', '').trim();
  if (!name) throw new BadRequestException('name is required');
  if (name.length > DEVICE_NAME_MAX) {
    throw new BadRequestException(
      `name must be at most ${DEVICE_NAME_MAX} characters`,
    );
  }
  if (payload.type === undefined || payload.type === null) {
    throw new BadRequestException('type is required');
  }
  if (
    typeof payload.type !== 'string' ||
    !(DEVICE_TYPES as readonly string[]).includes(payload.type)
  ) {
    throw new BadRequestException(
      `type must be one of ${DEVICE_TYPES.join(', ')}`,
    );
  }
  return { name, type: payload.type as DeviceType };
}

/** A fresh id for a dashboard device. */
export function manualDeviceId(): string {
  return `manual-${randomUUID()}`;
}
