import { slugFromName } from '../agents/agent-merge';

/**
 * Agent id that seed:demo stores on a ticket assignee and a run agent.
 * Office seats that bot only when the stored string equals this id.
 */
export function demoAgentId(name: string): string {
  const id = slugFromName(name);
  if (!id) throw new Error(`demo agent has no id: ${name}`);
  return id;
}

export interface AssigneeRewrite {
  from: string;
  to: string;
}

/**
 * Crew display names and legacy demo names, mapped to agent ids.
 * A string that is already the id is left out.
 */
export function demoAssigneeRewrites(
  names: readonly string[],
  legacy: Readonly<Record<string, string>>,
): AssigneeRewrite[] {
  const to = new Map<string, string>();
  for (const name of names) {
    const id = demoAgentId(name);
    if (name !== id) to.set(name, id);
  }
  for (const [from, crewName] of Object.entries(legacy)) {
    to.set(from, demoAgentId(crewName));
  }
  return [...to.entries()].map(([from, id]) => ({ from, to: id }));
}
