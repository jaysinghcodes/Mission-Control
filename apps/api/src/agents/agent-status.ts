/**
 * Statuses stored on Agent.status.
 * The schema comment, the roster, and agents.snapshot use these two.
 * online is separate: it comes from lastSeenAt, not this column.
 */
export const AGENT_STATUSES = ['working', 'idle'] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function isAgentStatus(value: string): value is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}
