/**
 * Shared API types for the Mission Control web app.
 *
 * `Agent` is the roster shape returned by the API (`GET /agents` →
 * `{ agents: Agent[] }`, `GET /agents/:id` → `{ agent: Agent & { children } }`).
 *
 * MC-200: the profile fields (emoji, personalityTags, currentTask,
 * tasksCompleted, totalCost, recentActivity, channel) are bridge-pushed and
 * every one of them may be null until the bridge supplies it — pages must
 * render unchanged/gracefully when they are (null-safe, no layout shift).
 */

export interface Agent {
  id: string
  name: string
  color: string
  role: string | null
  status: string
  parentId: string | null
  // MC-200 profile fields — nullable on the wire; default to null/0 server-side.
  emoji: string | null
  personalityTags: string[] | null
  currentTask: string | null
  tasksCompleted: number
  totalCost: number
  recentActivity: string | null
  channel: string | null
}

export interface AgentsResp {
  agents: Agent[]
  ts: number
}

export interface AgentDetailResp {
  agent: Agent & { children: Agent[] }
  ts: number
}

/** Project from GET /projects (ticket 4). `nameKey` is not on the wire. */
export interface Project {
  id: string
  name: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** Tickets on this project, including ones that are not done. */
  ticketCount: number
  /** Tickets whose status is `done`. The page renders "doneCount of ticketCount". */
  doneCount: number
}

export interface ProjectsResp {
  projects: Project[]
  ts: number
}

export interface ProjectTicket {
  id: string
  key: string | null
  title: string
  status: string
  priority: string
  assignee: string | null
  createdAt: string
}

export interface ProjectDetailResp {
  project: Project
  tickets: ProjectTicket[]
  ts: number
}
