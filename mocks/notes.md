# Mission Control page mocks: notes (example data)

Rendered by `/workspace/robot-roster/pages/render-all.tsx`. The shared chrome lives in `pages/kit.tsx`, with one file per page.
Run `cd /workspace/robot-roster && npx tsx pages/render-all.tsx [page…] && npx tsx pages/contact.tsx`.

**Global rules.** Agents always appear as the 12 shipped roster robots (RobotAvatar slots 0-11). Every agent is shown with its cool name plus a function tag, e.g. "Forge · Engineer", "Aegis · Security", "Scout · Trends". Red appears only for "needs you", and Approvals keeps its red sidebar badge. Secondary text is #6e6e73 in light mode for AA contrast; dark mode keeps #98989d, which is about 6:1 on #1c1c1e. The account chip uses the app's own icon, `apps/web/public/logo.svg` (the same file the current sidebar brand and Connect page use).

- **Tasks**: What's being worked on and what's next. *At a glance:* a 4-column board (To-Do / Build / QA / Review), each card showing title, robot with "name · function" and key; the one "Needs you" card is flagged red; Done is collapsed to a count. *Behind a click:* the task detail, the Backlog tab, and the Done list.
- **Agents**: Who is doing what right now. *At a glance:* 12 cards sorted needs-you → working → idle, each with robot, name, function, status chip and a one-line "Now". *Behind a click:* the profile drawer.
- **Approvals**: Decide what agents are waiting on. *At a glance:* the single pending request (Aegis · Security) with Approve/Deny, what's coming up, and today's decisions. *Behind a click:* "Show details" (command, scope) and the Decided tab.
- **Projects** (ticket 4): Each project's progress, with the list kept tidy. *At a glance:* rows showing lead robot, "X of Y done" with a bar, an Active/Archived/All filter, a needs-you flag, and Archive on hover. *Behind a click:* the project's tasks and the archived list.
- **Office** (approved): A live picture of the floor. *At a glance:* Build/QA/Ship/Deploy rooms with tagged robots at desks, Commons, Activity and Pipeline counts. *Behind a click:* an agent or room.
- **Pipeline**: Follow work from Build to Deploy. *At a glance:* 4 stage counts plus one row per moving item, with a Build→QA→Ship→Deploy track, times and time in stage. *Behind a click:* the item's timeline and "deployed today".
- **Calendar**: When scheduled jobs run. *At a glance:* a week grid of the 6 seeded cron jobs with the owner robot on each block and a now-line, plus Today and Coming up. *Behind a click:* a job's schedule, history and run-now.
- **Memory**: What agents remember. *At a glance:* a searchable list grouped by day, with the selected memory open in a reader. *Behind a click:* other memories, the source, and where each is used.
- **Docs**: The specs, briefs and notes agents write. *At a glance:* 8 recent doc cards (preview, type, state, author robot with function, date). *Behind a click:* opening a doc, plus the type filters.
- **Team**: The mission, people and devices. *At a glance:* the editable mission, Jay as owner, all 12 robots linking to Agents, and 3 devices with online/last-seen. *Behind a click:* edit, invite, pair a device.
- **System**: Is everything healthy, and what is it costing? *At a glance:* one status line with API / bridge / host; a **Models & spend** card with Today / This week / This month totals and one row per model (tokens this month, spend for each period, robots of the agents using it); the one recent issue. *Behind a click:* per-model details (per agent, per session, price override), Logs, Sessions, Connection, Settings.
- **Setup (first run)**: Get from a fresh clone to a working dashboard. This is the existing `/connect` page (Connect.tsx + ConnectSteps.tsx) with its real 8 ONBOARDING.md steps: Confirm prerequisites, Clone and install, Create the root .env, Start the stack, Verify the dashboard, Connect OpenClaw (the bridge), Connect from another machine, and Smoke test. It's shown as a centered onboarding sheet with a step indicator and one decision per step; the mock shows step 6 (connect the bridge or skip with `npm run seed:demo`), with a single primary "Continue". *Behind a click:* each step's commands and fields. Step 3 holds the real env vars (DATABASE_URL, INGEST_TOKEN, SOCKET_TOKEN, WEB_ORIGIN, optional GitHub/DeepSeek/ZAI keys), and step 7 holds the OS picker, the SSH tunnel command and the live API check.

## Models & spend: approach chosen

**Auto-detect from OpenClaw sessions, with an optional per-model price override behind a click.**

Why it's the easier build with the repo's real data:
- The bridge (`bridge/mc-bridge-sync.py`) already runs `openclaw sessions --all-agents --json`. It reads each session's `model`, `inputTokens`, `outputTokens` and `costUsd`/`estimatedCostUsd`.
- `usage_from_sessions()` already rolls those up per model into `usage.snapshot` as `providers: [{name, model, tokensIn, tokensOut, cost}]`.
- The API stores one `UsageSnapshot` per period (`24h | 7d | 30d | month`), and `GET /usage?period=` plus `Usage.tsx` already handle all four periods.
- What's missing: the bridge only posts `24h` today, so emitting `7d` and `month` is the same function with a different time window. No schema change and no user data entry.

Why not a user-entered model list:
- It would need new price fields on `ModelConfig`, a pricing form, and a token source anyway, because tokens only come from OpenClaw sessions.

Caveats:
- Session token counters are cumulative, so a long session is counted in the window of its last activity. That's why the UI says "estimated".
- When OpenClaw reports no cost for a model, "Set a price for a model" stores a per-token price. That adds price fields to the existing `ModelConfig` table later, and only if needed.
