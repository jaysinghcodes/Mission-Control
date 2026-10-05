/**
 * Mock / placeholder data — extracted verbatim from wireframes/gen_wireframes.py.
 *
 * These are the wireframe values the design review shipped with. Screens that
 * have a real backend (Health → GET /health, Live Activity → Socket.IO feed)
 * prefer live data and fall back to these rows only when the backend is down.
 * Agent colors are CSS vars so they resolve per-theme (identical in both).
 */

export const AGENT_COLORS: Record<string, string> = {
  Henry: 'var(--mc-henry)',
  Ralph: 'var(--mc-ralph)',
  Scout: 'var(--mc-scout)',
  Echo: 'var(--mc-echo)',
  Charlie: 'var(--mc-charlie)',
  Codex: 'var(--mc-codex)',
  Violet: 'var(--mc-violet)',
  Quill: 'var(--mc-quill)',
  Pixel: 'var(--mc-pixel)',
  main: 'var(--mc-primary)',
}

export const agentColor = (name: string): string => AGENT_COLORS[name] ?? 'var(--mc-primary)'

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

export interface NavItem { key: string; label: string; path: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'WORKSPACE',
    items: [
      { key: 'overview', label: 'Overview', path: '/' },
      { key: 'tasks', label: 'Tasks', path: '/tasks' },
      { key: 'tickets', label: 'Tickets', path: '/tickets' },
      { key: 'backlog', label: 'Backlog', path: '/backlog' },
      { key: 'calendar', label: 'Calendar', path: '/calendar' },
      { key: 'approvals', label: 'Approvals', path: '/approvals' },
    ],
  },
  {
    label: 'TEAM',
    items: [
      { key: 'team', label: 'Team', path: '/team' },
      { key: 'office', label: 'Office', path: '/office' },
      { key: 'activity', label: 'Live Activity', path: '/activity' },
    ],
  },
  {
    label: 'OBSERVE',
    items: [
      { key: 'health', label: 'Health', path: '/health' },
      { key: 'sessions', label: 'Sessions', path: '/sessions' },
      { key: 'usage', label: 'Usage & Cost', path: '/usage' },
      { key: 'logs', label: 'Logs', path: '/logs' },
    ],
  },
]

/* ── Overview ────────────────────────────────────────────────────────────── */

export const OVERVIEW_KPIS = [
  { value: '3', label: 'Tasks Running' },
  { value: '5', label: 'Pending Approvals' },
  { value: '14', label: 'Shipped Today' },
  { value: '$4.82', label: 'Spend · 24H' },
]

export const OVERVIEW_ACTIVITY = [
  { agent: 'Henry', color: agentColor('Henry'), action: 'web_search · openclaw auth tokens' },
  { agent: 'Ralph', color: agentColor('Ralph'), action: 'read · wireframes/gen_v4.py' },
  { agent: 'Scout', color: agentColor('Scout'), action: 'web_fetch · docs.openclaw.ai/tailscale' },
]

export const OVERVIEW_APPROVALS = [
  { desc: 'Henry · apt install nginx', color: 'var(--mc-red)' },
  { desc: 'iPhone · pairing request', color: 'var(--mc-blue)' },
  { desc: 'Echo · launch announcement', color: 'var(--mc-purple)' },
  { desc: 'Ralph · session fork', color: 'var(--mc-teal)' },
]

/* ── Tasks ───────────────────────────────────────────────────────────────── */

export interface TaskRow { name: string; agent: string; status: 'running' | 'queued' | 'done'; prog: number; started: string; dur: string }
export interface TaskGroup { title: string; rows: TaskRow[] }

export const TASK_GROUPS: TaskGroup[] = [
  {
    title: 'In Flight',
    rows: [
      { name: 'Deploy mission-control to staging', agent: 'Henry', status: 'running', prog: 62, started: '12:01', dur: '0:42' },
      { name: 'QA review · wireframe feedback', agent: 'Ralph', status: 'running', prog: 34, started: '12:03', dur: '0:21' },
    ],
  },
  {
    title: 'Queued',
    rows: [
      { name: 'Draft content brief for launch', agent: 'Quill', status: 'queued', prog: 0, started: '—', dur: '—' },
      { name: 'Scan competitor pricing pages', agent: 'Scout', status: 'queued', prog: 0, started: '—', dur: '—' },
    ],
  },
  {
    title: 'Done Today',
    rows: [
      { name: 'README + docs polish', agent: 'Codex', status: 'done', prog: 100, started: '11:24', dur: '3:12' },
      { name: 'Discord channel layout', agent: 'Pixel', status: 'done', prog: 100, started: '10:58', dur: '1:05' },
      { name: 'Trend report · weekly', agent: 'Scout', status: 'done', prog: 100, started: '09:40', dur: '2:10' },
    ],
  },
]

/* ── Agents tree ─────────────────────────────────────────────────────────── */

export interface AgentNode { name: string; role: string; color: string; status: 'working' | 'idle'; sub?: string }

export const AGENT_MAIN: AgentNode = { name: 'main', role: 'Operator · Lead', color: agentColor('main'), status: 'working' }
export const AGENT_PARENTS: AgentNode[] = [
  { name: 'Henry', role: 'Build · Orchestrator', color: agentColor('Henry'), status: 'working', sub: '2 sub-agents' },
  { name: 'Ralph', role: 'QA Manager', color: agentColor('Ralph'), status: 'working', sub: '2 sub-agents' },
  { name: 'Echo', role: 'Content · Social', color: agentColor('Echo'), status: 'idle', sub: '2 sub-agents' },
]
export const AGENT_KIDS: AgentNode[] = [
  { name: 'Charlie', role: 'Infra Eng', color: agentColor('Charlie'), status: 'idle' },
  { name: 'Codex', role: 'Docs & Memory', color: agentColor('Codex'), status: 'idle' },
  { name: 'Scout', role: 'Audits', color: agentColor('Scout'), status: 'working' },
  { name: 'Violet', role: 'Review', color: agentColor('Violet'), status: 'idle' },
  { name: 'Quill', role: 'Writer', color: agentColor('Quill'), status: 'idle' },
  { name: 'Pixel', role: 'Designer', color: agentColor('Pixel'), status: 'idle' },
]

export const TEAM_STATUS = [
  { label: 'Working', color: 'var(--mc-green)', value: '' },
  { label: 'Idle', color: 'var(--mc-faint)', value: '' },
  { label: 'Total agents', color: 'var(--mc-text)', value: '7' },
  { label: 'Sub-agents live', color: 'var(--mc-purple)', value: '4' },
]

/* ── Tickets kanban ──────────────────────────────────────────────────────── */

export interface Ticket { id: string; title: string; prio: 'high' | 'med'; assignee: string; tags: string[] }

export const TICKET_COLUMNS: { title: string; tickets: Ticket[] }[] = [
  {
    title: 'To-Do',
    tickets: [
      { id: 'MC-142', title: 'Build task executor', prio: 'high', assignee: 'Henry', tags: ['core', 'v2'] },
      { id: 'MC-143', title: 'Wireframe family tree', prio: 'med', assignee: 'Pixel', tags: ['design'] },
      { id: 'MC-144', title: 'Ticket API schema', prio: 'med', assignee: 'Charlie', tags: ['api'] },
    ],
  },
  {
    title: 'In Progress',
    tickets: [
      { id: 'MC-140', title: 'Mission Control scaffold', prio: 'high', assignee: 'Henry', tags: ['core'] },
      { id: 'MC-141', title: 'QA · approval flow', prio: 'high', assignee: 'Ralph', tags: ['qa'] },
      { id: 'MC-138', title: 'Live activity feed', prio: 'med', assignee: 'Scout', tags: ['ui'] },
    ],
  },
  {
    title: 'Done',
    tickets: [
      { id: 'MC-137', title: 'Gateway auth connect', prio: 'high', assignee: 'Henry', tags: ['core'] },
      { id: 'MC-135', title: 'Logs tail viewer', prio: 'med', assignee: 'Codex', tags: ['ui'] },
    ],
  },
]

export const TICKET_METRICS = [
  { label: 'Shipped Today', value: '3' },
  { label: 'In Progress', value: '4' },
  { label: 'Backlog', value: '12' },
  { label: 'Blocked', value: '1' },
  { label: 'Avg Pipeline Time', value: '4h 12m' },
]

/* ── Backlog ─────────────────────────────────────────────────────────────── */

export interface BacklogRow { id: string; title: string; prio: 'high' | 'med' | 'low'; tags: string[]; pts: number; age: string }

export const BACKLOG_ROWS: BacklogRow[] = [
  { id: 'MC-144', title: 'Ticket API schema', prio: 'med', tags: ['api', 'core'], pts: 5, age: '2d' },
  { id: 'MC-146', title: 'Agent status WebSocket', prio: 'high', tags: ['core'], pts: 8, age: '1d' },
  { id: 'MC-147', title: 'Calendar drag & drop', prio: 'low', tags: ['ui'], pts: 3, age: '1d' },
  { id: 'MC-148', title: 'Usage CSV export', prio: 'low', tags: ['reporting'], pts: 2, age: '5h' },
  { id: 'MC-149', title: 'Pipeline block reasons', prio: 'med', tags: ['pipeline'], pts: 5, age: '3h' },
  { id: 'MC-150', title: 'Dark log syntax colors', prio: 'low', tags: ['ui', 'logs'], pts: 2, age: '2h' },
  { id: 'MC-151', title: 'Sub-agent tree collapse', prio: 'med', tags: ['agents'], pts: 3, age: '1h' },
]

/* ── Calendar ────────────────────────────────────────────────────────────── */

export interface CalEvent { col: number; r0: number; hh: number; label: string; color: string; time: string }

export const CALENDAR_EVENTS: CalEvent[] = [
  { col: 1, r0: 0.9, hh: 0.62, label: 'Morning Brief', color: 'var(--mc-yellow)', time: '6:30a' },
  { col: 1, r0: 2.4, hh: 0.5, label: 'Poller', color: '#8A939E', time: '11:00a' },
  { col: 2, r0: 1.4, hh: 0.55, label: 'Trend Radar', color: 'var(--mc-orange)', time: '9:00a' },
  { col: 3, r0: 0.9, hh: 0.62, label: 'Scout Scan', color: 'var(--mc-green)', time: '6:55a' },
  { col: 3, r0: 2.6, hh: 0.5, label: 'YouTube', color: 'var(--mc-red)', time: '12:00p' },
  { col: 4, r0: 1.1, hh: 0.55, label: 'Quill Writer', color: 'var(--mc-teal)', time: '8:00a' },
  { col: 5, r0: 2.2, hh: 0.5, label: 'Content Sync', color: 'var(--mc-purple)', time: '10:30a' },
  { col: 6, r0: 1.7, hh: 0.55, label: 'Weekly', color: 'var(--mc-blue)', time: '9:30a' },
]

export const CALENDAR_LEGEND = [
  { label: 'Morning Brief', color: 'var(--mc-yellow)' },
  { label: 'Trend Radar', color: 'var(--mc-orange)' },
  { label: 'Scout Scan', color: 'var(--mc-green)' },
  { label: 'Quill Writer', color: 'var(--mc-teal)' },
  { label: 'Weekly', color: 'var(--mc-blue)' },
  { label: 'YouTube', color: 'var(--mc-red)' },
]

/* ── Approvals ───────────────────────────────────────────────────────────── */

export interface ApprovalRow { kind: 'exec' | 'pair' | 'msg' | 'sess'; tag: string; desc: string; ago: string; color: string }

export const APPROVAL_FILTERS = ['All', 'Exec', 'Pairing', 'Messages', 'Sessions']

export const APPROVAL_ROWS: ApprovalRow[] = [
  { kind: 'exec', tag: 'Exec · gateway', desc: 'Henry wants to run: apt install nginx on gateway', ago: '2 min ago', color: 'var(--mc-red)' },
  { kind: 'pair', tag: 'Device pairing', desc: 'New device: iPhone 15 requests operator access', ago: '11 min ago', color: 'var(--mc-blue)' },
  { kind: 'msg', tag: 'Message · discord', desc: 'Echo wants to post launch announcement in #announcements', ago: '24 min ago', color: 'var(--mc-purple)' },
  { kind: 'exec', tag: 'Exec · sandbox', desc: 'Scout wants to run: npm install in /tmp/scan', ago: '1 hr ago', color: 'var(--mc-red)' },
  { kind: 'sess', tag: 'Session fork', desc: 'Ralph wants to fork session \'wireframes\' into \'wireframes-v2\'', ago: '2 hrs ago', color: 'var(--mc-teal)' },
]

/* ── Office ──────────────────────────────────────────────────────────────── */

export const OFFICE_STATS = [
  { label: 'Shipped Today', value: '3' },
  { label: 'Active Bots', value: '5' },
  { label: 'Cycle Time', value: '4h 12m' },
  { label: 'Throughput', value: '0.8/h' },
  { label: 'Blocked', value: '1' },
]

export const OFFICE_BOTS = [
  { name: 'Henry', color: agentColor('Henry'), task: 'task-executor · 62%', status: 'working' },
  { name: 'Ralph', color: agentColor('Ralph'), task: 'review · 34%', status: 'working' },
  { name: 'Violet', color: agentColor('Violet'), task: 'checklist', status: 'idle' },
  { name: 'Pixel', color: agentColor('Pixel'), task: 'og images · done', status: 'working' },
]

export const OFFICE_TRANSIT = [
  { name: 'Scout', color: agentColor('Scout'), chip: '→ QA', chipBg: 'var(--mc-greenbg)', chipFg: 'var(--mc-greentext)' },
  { name: 'Quill', color: agentColor('Quill'), chip: '→ REVIEW', chipBg: 'var(--mc-tealbg)', chipFg: 'var(--mc-tealtext)' },
]

export const OFFICE_LOG = [
  { tm: '12:04:33', agent: 'Henry', msg: 'committed 8f3a2c1 · task-executor v0.2', color: 'var(--mc-bluetext)' },
  { tm: '12:04:19', agent: 'Charlie', msg: 'scaffold modules wired → BUILD', color: 'var(--mc-bluetext)' },
  { tm: '12:03:41', agent: 'Scout', msg: 'passed QA gate → moving to REVIEW', color: 'var(--mc-greentext)' },
]

/* ── Live Activity ───────────────────────────────────────────────────────── */

export const ACTIVITY_ZONES = [
  { name: 'Build', agents: [{ name: 'Henry', color: agentColor('Henry'), task: 'deploy · 62%' }, { name: 'Charlie', color: agentColor('Charlie'), task: 'scaffold' }] },
  { name: 'QA', agents: [{ name: 'Ralph', color: agentColor('Ralph'), task: 'review · 34%' }, { name: 'Violet', color: agentColor('Violet'), task: 'checklist' }] },
  { name: 'Research', agents: [{ name: 'Scout', color: agentColor('Scout'), task: 'pricing scan' }] },
  { name: 'Content', agents: [{ name: 'Quill', color: agentColor('Quill'), task: 'brief draft' }, { name: 'Echo', color: agentColor('Echo'), task: 'announcement' }] },
]

export interface ActivityEvent { tm: string; agent: string; color: string; zone: string; desc: string; accent: string }

export const ACTIVITY_EVENTS: ActivityEvent[] = [
  { tm: '12:01:42', agent: 'Henry', color: agentColor('Henry'), zone: 'BUILD', desc: 'web_search · openclaw gateway auth', accent: 'var(--mc-bluetext)' },
  { tm: '12:02:03', agent: 'Ralph', color: agentColor('Ralph'), zone: 'QA', desc: 'read · wireframes/gen_v4.py', accent: 'var(--mc-bluetext)' },
  { tm: '12:02:14', agent: 'Henry', color: agentColor('Henry'), zone: 'BUILD', desc: 'Deployment started — build #42', accent: 'var(--mc-purpletext)' },
  { tm: '12:03:18', agent: 'Ralph', color: agentColor('Ralph'), zone: 'QA', desc: 'exec · node wstest.mjs · exit 0', accent: 'var(--mc-bluetext)' },
  { tm: '12:03:41', agent: 'Scout', color: agentColor('Scout'), zone: 'RESEARCH', desc: 'web_fetch · docs.openclaw.ai/tailscale', accent: 'var(--mc-bluetext)' },
  { tm: '12:04:19', agent: 'Charlie', color: agentColor('Charlie'), zone: 'BUILD', desc: 'EAI_AGAIN · api.deepseek.com (retry 2/3)', accent: 'var(--mc-redtext)' },
  { tm: '12:04:33', agent: 'Henry', color: agentColor('Henry'), zone: 'BUILD', desc: 'git commit 8f3a2c1 · wireframes', accent: 'var(--mc-bluetext)' },
]

/* ── Health ──────────────────────────────────────────────────────────────── */

export const HEALTH_METRICS = [
  { label: 'CPU', big: '23%', pct: 23, color: 'var(--mc-green)', sub: '0.23 · 4 cores' },
  { label: 'Memory', big: '61%', pct: 61, color: 'var(--mc-orange)', sub: '3.9 / 6.4 GB' },
  { label: 'Disk', big: '42%', pct: 42, color: 'var(--mc-green)', sub: '18 / 42 GB' },
  { label: 'WS Latency', big: '74ms', pct: 100, color: 'var(--mc-blue)', sub: '74 ms · loopback' },
  { label: 'Provider', big: 'ok', pct: 100, color: 'var(--mc-green)', sub: 'deepseek · ok' },
]

export const HEALTH_ACCESS = [
  { k: 'WebSocket', v: 'ws://127.0.0.1:18789 (loopback)' },
  { k: 'Auth mode', v: 'token · rate-limited' },
  { k: 'Version', v: 'stable · node 26.5.1 · linux arm64' },
  { k: 'Channels', v: 'discord ON' },
]

/* ── Sessions ────────────────────────────────────────────────────────────── */

export interface SessionRow { session: string; agent: string; color: string; model: string; ctx: number; last: string; hot: boolean }

export const SESSION_ROWS: SessionRow[] = [
  { session: 'main · discord', agent: 'main', color: agentColor('main'), model: 'deepseek-v4-flash', ctx: 42, last: '1m ago', hot: false },
  { session: 'mission-control · dev', agent: 'henry', color: agentColor('Henry'), model: 'deepseek-v4-flash', ctx: 18, last: '2m ago', hot: false },
  { session: 'research · wireframes', agent: 'main', color: agentColor('main'), model: 'deepseek-v4-flash', ctx: 67, last: '12m ago', hot: true },
  { session: 'qa · review', agent: 'ralph', color: agentColor('Ralph'), model: 'zai/glm-5.2', ctx: 8, last: '24m ago', hot: false },
  { session: 'content · launch', agent: 'echo', color: agentColor('Echo'), model: 'deepseek-v4-flash', ctx: 91, last: '1h ago', hot: true },
]

/* ── Usage & Cost ────────────────────────────────────────────────────────── */

export const USAGE_PROVIDERS = [
  { name: 'DeepSeek', dot: 'var(--mc-blue)', model: 'deepseek-v4-flash', cost: '$1.05', pct: 82, detail: 'input 980K · output 260K' },
  { name: 'Z.AI (GLM)', dot: 'var(--mc-purple)', model: 'glm-5.2', cost: '$0.31', pct: 15, detail: 'input 210K · output 68K' },
  { name: 'Other / fallback', dot: 'var(--mc-faint)', model: '—', cost: '$0.12', pct: 3, detail: 'input 18K · output 4K' },
]

/* ── Logs ────────────────────────────────────────────────────────────────── */

export interface LogLine { tm: string; lvl: 'INFO' | 'WARN' | 'ERROR'; msg: string; color: string }

export const LOG_LINES: LogLine[] = [
  { tm: '20:47:38', lvl: 'WARN', msg: '[ws] unauthorized conn=46b7… reason=token_missing', color: 'var(--mc-orange)' },
  { tm: '20:47:38', lvl: 'INFO', msg: '[ws] closed before connect code=4008 phase=auth', color: 'var(--mc-sub)' },
  { tm: '20:48:08', lvl: 'WARN', msg: '[ws] unauthorized conn=3bd6… reason=token_missing', color: 'var(--mc-orange)' },
  { tm: '20:48:30', lvl: 'INFO', msg: '[model-fetch] start provider=deepseek model=deepseek-v4-flash', color: 'var(--mc-sub)' },
  { tm: '20:48:30', lvl: 'INFO', msg: '[model-fetch] response status=200 elapsedMs=698', color: 'var(--mc-sub)' },
  { tm: '20:49:08', lvl: 'ERROR', msg: '[ws] ✗ system-presence missing scope: operator.read', color: 'var(--mc-redtext)' },
  { tm: '20:49:09', lvl: 'INFO', msg: '[model-fetch] start provider=deepseek model=deepseek-v4-flash', color: 'var(--mc-sub)' },
  { tm: '20:49:10', lvl: 'INFO', msg: '[model-fetch] response status=200 elapsedMs=804', color: 'var(--mc-sub)' },
]
