/**
 * Turn a sticker reference into an agent id at ingest.
 *
 * An exact agent id is kept. A display name becomes an id only when one
 * agent has that name. Zero matches, or two agents named Forge, stay
 * unresolved. The screen then draws a generic sticker. This does not
 * seat a bot: ticket assignees and run agents stay the string that was
 * stored.
 */

export interface AgentName {
  id: string;
  name: string;
}

const ID_ACTIONS = new Set(['register', 'delete']);

export function resolveIngestAgent(
  raw: string | null | undefined,
  agents: readonly AgentName[],
): string | null {
  const key = (raw ?? '').trim();
  if (!key) return null;
  const byId = agents.find((agent) => agent.id === key);
  if (byId) return byId.id;
  const named = agents.filter((agent) => agent.name.trim() === key);
  if (named.length === 1) return named[0].id;
  return null;
}

/**
 * Activity payloads. Register, delete, and status already carry the
 * agent id on `id`, and that id wins over a display name on `agent`.
 * A run id is not an agent id, so it does not replace `agent`.
 * A name that resolves is stored as the id. Anything else is left as sent.
 */
export function stampActivityAgent(
  payload: Record<string, unknown>,
  agents: readonly AgentName[],
  type?: string,
): Record<string, unknown> {
  const action = typeof payload.action === 'string' ? payload.action : '';
  const idRaw = typeof payload.id === 'string' ? payload.id.trim() : '';
  const idIsAgent = !!idRaw && agents.some((agent) => agent.id === idRaw);
  if (idIsAgent && (type === 'agent.status' || ID_ACTIONS.has(action))) {
    return { ...payload, agent: idRaw };
  }
  const agentRaw = typeof payload.agent === 'string' ? payload.agent : '';
  if (!agentRaw.trim()) return payload;
  const resolved = resolveIngestAgent(agentRaw, agents);
  if (!resolved || resolved === agentRaw) return payload;
  return { ...payload, agent: resolved };
}

/** Roster rows for ingest. A test double with no agent table loads nothing. */
export async function loadAgentNames(prisma: {
  agent?: {
    findMany?: (query: {
      select: { id: true; name: true };
    }) => Promise<AgentName[]>;
  };
}): Promise<AgentName[]> {
  if (typeof prisma.agent?.findMany !== 'function') return [];
  try {
    return await prisma.agent.findMany({ select: { id: true, name: true } });
  } catch {
    return [];
  }
}
