#!/usr/bin/env python3
"""
mc-bridge-sync.py — minimal OpenClaw → Mission Control bridge (ticket 2).

Vendored into the repo so a fresh clone ships with the integration piece.
It used to live only on the operator's box at ~/.openclaw/.mc-bridge-sync.py.

ONE RUN = collect OpenClaw state once, POST it, exit. Schedule it every ~5 min
(system cron or an OpenClaw cron job) — see bridge/README.md.

  collect                                 POST /events (x-ingest-token)
  ───────────────────────────────────     ─────────────────────────────
  openclaw agents list --json         →   agents.snapshot
  openclaw sessions --all-agents --json → sessions.snapshot
  openclaw cron list --all --json     →   calendar.snapshot
                                          + run.* for job-state changes
  (derived from sessions token counts) →  usage.snapshot × 3 (24h, 7d, month)
  $MC_BRIDGE_APPROVALS_CMD (optional) →   approvals.snapshot
  agent workspace MEMORY.md + memory/*.md → memory.snapshot

Design rules (why the code looks the way it does):
  * stdlib only — runs under any python3 >= 3.8 with zero installs.
  * NEVER WIPE ON FAILURE. Snapshots are replace-semantics on the API side
    (SnapshotsService deletes + re-inserts). If a source is unavailable (no
    `openclaw` on PATH, non-zero exit, bad JSON) that snapshot is SKIPPED, not
    sent empty — otherwise a broken bridge would erase the dashboard (or the
    demo seed). An instance that genuinely has zero items still posts [].
  * run.* events are emitted only on CHANGE, using a small state file, so the
    activity feed is not flooded with duplicates every 5 minutes.
  * Secrets: INGEST_TOKEN comes from the environment or the repo-root .env.
    It is sent only as the x-ingest-token header and is NEVER printed, even
    with --dry-run.

Usage:
  python3 bridge/mc-bridge-sync.py              # collect + post
  python3 bridge/mc-bridge-sync.py --dry-run    # collect + print payloads, post nothing
  python3 bridge/mc-bridge-sync.py --from-dir bridge/examples   # use JSON files instead of the CLI
  python3 bridge/mc-bridge-sync.py --dry-run --memory-dir bridge/examples/openclaw-memory
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── Paths / config ──────────────────────────────────────────────────────────

BRIDGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BRIDGE_DIR.parent

# Loopback by default — same posture as the api (binds 127.0.0.1).
DEFAULT_API_URL = "http://127.0.0.1:3000"

# Where we remember last-seen cron job state between runs (for run.* diffs).
# Lives next to the script, git-ignored (bridge/.state/). Override with
# MC_BRIDGE_STATE_FILE if the clone is read-only.
DEFAULT_STATE_FILE = BRIDGE_DIR / ".state" / "last-run.json"

# Palette for agents when OpenClaw supplies no color (matches the web tokens).
AGENT_COLORS = ["#A371F7", "#D29922", "#3FB950", "#39C5CF", "#58A6FF", "#F78166"]

# A session counts as "hot" (and its agent as "working") if updated this recently.
HOT_WINDOW_MS = 10 * 60 * 1000


def log(msg: str) -> None:
    """All diagnostics go to stderr so stdout stays clean for --dry-run JSON."""
    print(f"[mc-bridge] {msg}", file=sys.stderr)


# ── .env loading (no python-dotenv dependency) ──────────────────────────────

def load_dotenv(path: Path) -> None:
    """Minimal KEY=VALUE loader. Real environment variables always win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        val = val.strip()
        # Strip one layer of matching quotes: KEY="value" / KEY='value'.
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        if key and key not in os.environ:
            os.environ[key] = val


# ── Sources ─────────────────────────────────────────────────────────────────

class Sources:
    """
    Where raw OpenClaw data comes from. Two modes:
      * CLI (default): shell out to `openclaw … --json`.
      * --from-dir DIR: read DIR/{agents,sessions,cron,approvals}.json — used
        for testing the mapping without an OpenClaw install (see bridge/examples).
    Every getter returns parsed JSON or None (= source unavailable → skip).
    """

    def __init__(self, from_dir: Optional[Path]) -> None:
        self.from_dir = from_dir

    def _file(self, name: str) -> Optional[Any]:
        assert self.from_dir is not None
        p = self.from_dir / f"{name}.json"
        if not p.is_file():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log(f"{p}: bad JSON ({e}) — skipping")
            return None

    def _cli(self, argv: List[str]) -> Optional[Any]:
        """Run a command expected to print JSON. Never raises."""
        try:
            proc = subprocess.run(argv, capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            log(f"`{argv[0]}` not found on PATH — skipping {' '.join(argv[1:3])}")
            return None
        except subprocess.TimeoutExpired:
            log(f"`{' '.join(argv)}` timed out — skipping")
            return None
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout).strip().splitlines()[-1:] or ["(no output)"]
            log(f"`{' '.join(argv)}` exited {proc.returncode}: {tail[0][:200]} — skipping")
            return None
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            log(f"`{' '.join(argv)}` did not print JSON — skipping")
            return None

    def agents(self) -> Optional[Any]:
        return self._file("agents") if self.from_dir else self._cli(["openclaw", "agents", "list", "--json"])

    def sessions(self) -> Optional[Any]:
        if self.from_dir:
            return self._file("sessions")
        return self._cli(["openclaw", "sessions", "--all-agents", "--json"])

    def cron(self) -> Optional[Any]:
        return self._file("cron") if self.from_dir else self._cli(["openclaw", "cron", "list", "--all", "--json"])

    def approvals(self) -> Optional[Any]:
        """
        OpenClaw has no stable "pending approvals" list command yet, so this is
        opt-in: set MC_BRIDGE_APPROVALS_CMD to any command that prints a JSON
        array (or {approvals:[…]}) of {kind, tag, desc, meta?}. Unset → skip,
        which PRESERVES whatever approvals Mission Control already has.
        """
        if self.from_dir:
            return self._file("approvals")
        cmd = os.environ.get("MC_BRIDGE_APPROVALS_CMD", "").strip()
        return self._cli(shlex.split(cmd)) if cmd else None


def as_list(raw: Any, *keys: str) -> Optional[List[Dict[str, Any]]]:
    """
    Normalize OpenClaw's --json list envelopes (they differ per command, see
    openclaw/openclaw#77943): bare array, or {<key>: [...]}, or {items: [...]}.
    Returns None if the shape is unrecognized (→ skip, never wipe).
    """
    if raw is None:
        return None
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, dict):
        for k in (*keys, "items"):
            if isinstance(raw.get(k), list):
                return [x for x in raw[k] if isinstance(x, dict)]
    return None


def first(d: Dict[str, Any], *keys: str) -> Any:
    """First non-empty value among keys (OpenClaw field names vary by version)."""
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return None


def to_ms(v: Any) -> Optional[int]:
    """Epoch ms from an int/float (ms or s) or ISO string; None if unparseable."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        if v <= 0:  # 0 / negative = "never" in OpenClaw state fields
            return None
        return int(v if v > 10_000_000_000 else v * 1000)
    if isinstance(v, str):
        try:
            from datetime import datetime
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return None
    return None


def ago(ms: Optional[int], now_ms: int) -> Optional[str]:
    """'3m ago' style label (Sessions page shows lastActivity as text)."""
    if ms is None:
        return None
    s = max(0, (now_ms - ms) // 1000)
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60}m ago"
    if s < 86400:
        return f"{s // 3600}h ago"
    return f"{s // 86400}d ago"


# ── Mapping: OpenClaw JSON → Mission Control snapshot payloads ──────────────
# Output shapes are dictated by apps/api/src/snapshots/snapshots.service.ts.

def map_sessions(rows: List[Dict[str, Any]], now_ms: int) -> List[Dict[str, Any]]:
    out = []
    for s in rows:
        updated = to_ms(first(s, "updatedAt", "updatedAtMs", "lastActivityAt"))
        total = first(s, "totalTokens", "tokens") or 0
        window = first(s, "contextTokens", "contextWindow") or 0
        # ctx = context-window fill % when both numbers exist, else 0.
        try:
            ctx = int(round(100 * float(total) / float(window))) if window else 0
        except (TypeError, ValueError):
            ctx = 0
        out.append({
            "name": str(first(s, "key", "sessionKey", "id", "name") or "session"),
            "agent": str(first(s, "agentId", "agent") or "main"),
            "model": first(s, "model"),
            "ctx": max(0, min(ctx, 100)),
            "lastActivity": ago(updated, now_ms),
            "hot": updated is not None and now_ms - updated < HOT_WINDOW_MS,
            # Not stored by SnapshotsService; used below for usage + agent status.
            "_updatedMs": updated,
            "_in": first(s, "inputTokens") or 0,
            "_out": first(s, "outputTokens") or 0,
            "_cost": first(s, "costUsd", "estimatedCostUsd", "cost") or 0,
        })
    return out


def map_agents(rows: List[Dict[str, Any]], sessions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agent tree: the default agent (isDefault / id 'main') is the root; every
    other agent hangs under it unless OpenClaw names an explicit parent.
    `status` is derived: 'working' if the agent has a hot session.
    """
    hot_agents = {s["agent"] for s in sessions if s["hot"]}
    root = next((a for a in rows if a.get("isDefault")), None) or next(
        (a for a in rows if a.get("id") == "main"), None)

    def display(a: Dict[str, Any]) -> str:
        return str(first(a, "identityName", "name", "id") or "agent")

    root_name = display(root) if root else None
    out = []
    for i, a in enumerate(rows):
        aid = str(first(a, "id", "name") or "")
        name = display(a)
        out.append({
            "name": name,
            "role": first(a, "role") or aid or None,
            "color": first(a, "color") or AGENT_COLORS[i % len(AGENT_COLORS)],
            "status": "working" if aid in hot_agents else "idle",
            # Parent is sent as a NAME — SnapshotsService resolves it to an id.
            "parent": first(a, "parent") or (root_name if root_name and name != root_name else None),
            "emoji": first(a, "identityEmoji", "emoji"),
            "channel": first(a, "channel"),
        })
    return out


DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def cron_day_time(expr: str) -> Tuple[Optional[int], Optional[str]]:
    """
    Best-effort placement on the Calendar week grid from a 5-field cron expr.
      time: "HH:MM" when minute+hour are plain numbers, else None (all-day strip)
      day : 0=Mon … 6=Sun (Calendar.tsx columns start on Monday!) when the
            day-of-week field is ONE value, else None (= repeats every day)
    """
    parts = expr.split()
    if len(parts) < 5:
        return None, None
    minute, hour, dow = parts[0], parts[1], parts[4]
    tm = f"{int(hour):02d}:{int(minute):02d}" if minute.isdigit() and hour.isdigit() else None
    day = None
    if dow.isdigit():
        day = (int(dow) + 6) % 7  # cron 0/7=Sun,1=Mon → grid 0=Mon … 6=Sun
    elif dow.upper()[:3] in DOW and len(dow) == 3:
        day = DOW.index(dow.upper())
    return day, tm


def map_cron(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for j in rows:
        sched = j.get("schedule")
        label, day, tm = None, None, None
        # OpenClaw schedule shapes: {kind:"cron",expr}, {kind:"every",everyMs}, {kind:"at",at}
        if isinstance(sched, dict):
            kind = sched.get("kind")
            if kind == "cron" and isinstance(sched.get("expr"), str):
                label = sched["expr"]
                day, tm = cron_day_time(label)
            elif kind == "every" and sched.get("everyMs"):
                mins = max(1, int(sched["everyMs"]) // 60000)
                label = f"every {mins}m"  # interval → all-day strip
            elif kind == "at":
                label = f"at {sched.get('at')}"
        elif isinstance(sched, str):
            label = sched
            day, tm = cron_day_time(sched)
        status = str(j.get("status") or "")
        enabled = j.get("enabled")
        out.append({
            "name": str(first(j, "name", "id") or "job"),
            "schedule": label,
            "day": day,
            "time": tm,
            "enabled": (status != "disabled") if enabled is None else bool(enabled),
        })
    return out


def cron_run_events(rows: List[Dict[str, Any]], state: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    """
    Diff each job's run state against the previous bridge run and emit:
      run.running    — job started running since last time
      run.completed  — a new lastRunAtMs with status ok
      run.failed     — a new lastRunAtMs with status error
    First run for a job only records state (no backfill flood).
    Mutates `state` in place: {jobId: {"running": bool, "lastRunAtMs": int}}.
    """
    events = []
    for j in rows:
        jid = str(first(j, "id", "name") or "")
        if not jid:
            continue
        st = j.get("state") if isinstance(j.get("state"), dict) else {}
        running = bool(st.get("runningAtMs")) or j.get("status") == "running"
        last_at = to_ms(st.get("lastRunAtMs"))
        last_status = str(st.get("lastRunStatus") or st.get("lastStatus") or "")
        name = str(first(j, "name", "id"))
        prev = state.get(jid)
        if prev is not None:
            if running and not prev.get("running"):
                events.append(("run.running", {"name": name, "job": jid, "agent": j.get("agentId")}))
            if last_at and last_at != prev.get("lastRunAtMs"):
                ok = last_status in ("ok", "success", "done", "")
                events.append((
                    "run.completed" if ok else "run.failed",
                    {"name": name, "job": jid, "status": last_status or "ok", "agent": j.get("agentId")},
                ))
        state[jid] = {"running": running, "lastRunAtMs": last_at}
    return events


# 24h and 7d are trailing durations. `month` is the UTC calendar month to
# date (not the last 30 days). Session counters are cumulative, so a long
# session is counted in the window of its last activity (the UI says "estimated").
USAGE_WINDOWS = (
    ("24h", 86_400_000),
    ("7d", 7 * 86_400_000),
)


def month_start_utc_ms(now_ms: int) -> int:
    """00:00:00.000 UTC on the first day of the month that contains now_ms."""
    dt = datetime.datetime.fromtimestamp(now_ms / 1000.0, datetime.timezone.utc)
    start = dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return int(start.timestamp() * 1000)


def usage_from_sessions(
    sessions: List[Dict[str, Any]],
    now_ms: int,
    period: str = "24h",
    window_ms: Optional[int] = None,
    since_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """Usage rolled up from per-session token/cost counters.

    `period` is the UsageSnapshot key (24h | 7d | month). A duration window
    keeps sessions whose last activity is within `window_ms`. `month` with
    no explicit window uses the UTC calendar month (`_updatedMs >= month start`).
    Callers that only want the original 24h snapshot can keep calling
    usage_from_sessions(sessions, now_ms).
    """
    if period == "month" and since_ms is None and window_ms is None:
        since_ms = month_start_utc_ms(now_ms)
    if since_ms is not None:
        day = [s for s in sessions if s["_updatedMs"] and s["_updatedMs"] >= since_ms]
    else:
        if window_ms is None:
            window_ms = dict(USAGE_WINDOWS).get(period, 86_400_000)
        day = [s for s in sessions if s["_updatedMs"] and now_ms - s["_updatedMs"] < window_ms]

    def num(v: Any) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    # Per-model rollup. Usage.tsx / Health.tsx render each provider card from
    # {name, model, cost, tokensIn, tokensOut} (all optional), so we fill those.
    by_model: Dict[str, Dict[str, float]] = {}
    for s in day:
        m = s["model"] or "unknown"
        agg = by_model.setdefault(m, {"cost": 0.0, "in": 0.0, "out": 0.0})
        agg["cost"] += num(s["_cost"])
        agg["in"] += num(s["_in"])
        agg["out"] += num(s["_out"])

    def provider_name(model: str) -> str:
        # OpenClaw model ids are usually "<provider>/<model>" — the prefix is
        # the card title; bare ids fall back to the whole string.
        return model.split("/", 1)[0] if "/" in model else model

    return {
        "period": period,
        "totalCost": round(sum(num(s["_cost"]) for s in day), 4),
        "tokensIn": int(sum(num(s["_in"]) for s in day)),
        "tokensOut": int(sum(num(s["_out"]) for s in day)),
        "providers": [
            {"name": provider_name(m), "model": m, "cost": round(a["cost"], 4),
             "tokensIn": int(a["in"]), "tokensOut": int(a["out"])}
            for m, a in sorted(by_model.items())
        ],
    }


# ── Memory (OpenClaw workspace files → memory.snapshot) ────────────────────
# Confirmed from OpenClaw docs (docs.openclaw.ai/concepts/memory and
# concepts/agent-workspace):
#   * Each agent has one workspace. `openclaw agents list --json` includes
#     `workspace` (default ~/.openclaw/workspace, or agents.entries.*.workspace).
#   * MEMORY.md at the workspace root is curated long-term memory.
#   * memory/YYYY-MM-DD.md and memory/YYYY-MM-DD-<slug>.md are daily notes.
#     Slugged files are what the session-memory hook writes next to the
#     date-only file. Nested dirs (memory/.dreams, memory/imports) are not
#     daily notes and are not walked.
# The web app never reads these files. This bridge posts them.

DAILY_NOTE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:-.+)?\.md$")
MAX_MEMORY_BYTES = 1_000_000


def memory_stable_id(agent_id: str, rel: str) -> str:
    """Stable across re-syncs. Same agent + relative path → same id."""
    digest = hashlib.sha256(f"{agent_id}\n{rel}".encode("utf-8")).hexdigest()[:24]
    return f"mem-{digest}"


def iso_utc(mtime: float) -> str:
    dt = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def memory_title(body: str, fallback: str) -> str:
    for line in body.splitlines():
        text = line.strip()
        if not text:
            continue
        if text.startswith("#"):
            text = text.lstrip("#").strip()
        if text:
            return text[:200]
    return fallback[:200] or "Note"


def is_real_day(day: str) -> bool:
    try:
        datetime.datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def resolve_workspace(raw: str, base: Optional[Path]) -> Path:
    path = Path(os.path.expanduser(raw))
    if not path.is_absolute() and base is not None:
        path = base / path
    return path


def is_memory_workspace(path: Path) -> bool:
    return (path / "MEMORY.md").is_file() or (path / "memory").is_dir()


def agents_from_memory_dir(root: Path) -> Optional[List[Dict[str, Any]]]:
    """
    A sample OpenClaw memory dir is either one workspace (MEMORY.md or
    memory/ inside it) or a folder of per-agent workspaces. None if `root`
    does not exist — the caller skips the snapshot instead of posting [].
    """
    if not root.is_dir():
        return None
    if is_memory_workspace(root):
        return [{"id": root.name, "name": root.name, "identityName": root.name, "workspace": str(root)}]
    agents: List[Dict[str, Any]] = []
    for child in sorted(root.iterdir()):
        if child.name.startswith(".") or not child.is_dir():
            continue
        if is_memory_workspace(child):
            agents.append({
                "id": child.name,
                "name": child.name,
                "identityName": child.name,
                "workspace": str(child),
            })
    return agents


def _read_memory_text(path: Path) -> Optional[str]:
    try:
        size = path.stat().st_size
    except OSError as exc:
        log(f"{path}: {exc} — skipping")
        return None
    if size > MAX_MEMORY_BYTES:
        log(f"{path}: over 1MB — skipping")
        return None
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        log(f"{path}: {exc} — skipping")
        return None


def entry_from_file(
    agent_id: str,
    agent_name: str,
    workspace: Path,
    path: Path,
    kind: str,
) -> Optional[Dict[str, Any]]:
    text = _read_memory_text(path)
    if text is None:
        return None
    body = text.strip()
    if not body:
        return None
    rel = path.relative_to(workspace).as_posix()
    try:
        created = iso_utc(path.stat().st_mtime)
    except OSError as exc:
        log(f"{path}: {exc} — skipping")
        return None
    return {
        "id": memory_stable_id(agent_id, rel),
        "title": memory_title(body, path.stem),
        "body": body,
        "agent": agent_name,
        "createdAt": created,
        "kind": kind,
        "source": "openclaw",
        "ref": rel,
    }


def collect_memory(
    agents: List[Dict[str, Any]],
    base: Optional[Path] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Read each agent's MEMORY.md and memory/YYYY-MM-DD*.md.

    Returns None when agents were given but no workspace directory could be
    read (skip the snapshot — do not wipe). Returns [] when the source was
    readable and empty (a real empty memory dir still posts []).
    """
    if not agents:
        return []
    readable = 0
    by_id: Dict[str, Dict[str, Any]] = {}
    for agent in agents:
        raw = agent.get("workspace")
        if not isinstance(raw, str) or not raw.strip():
            continue
        workspace = resolve_workspace(raw, base)
        if not workspace.is_dir():
            log(f"memory workspace missing: {workspace} — skipping agent")
            continue
        readable += 1
        agent_id = str(first(agent, "id", "name") or workspace.name)
        agent_name = str(first(agent, "identityName", "name", "id") or agent_id)
        long_term = workspace / "MEMORY.md"
        if long_term.is_file():
            row = entry_from_file(agent_id, agent_name, workspace, long_term, "long-term")
            if row:
                by_id[row["id"]] = row
        daily_dir = workspace / "memory"
        if not daily_dir.is_dir():
            continue
        for path in sorted(daily_dir.iterdir()):
            if not path.is_file():
                continue
            match = DAILY_NOTE.match(path.name)
            if not match or not is_real_day(match.group(1)):
                continue
            row = entry_from_file(agent_id, agent_name, workspace, path, "daily")
            if row:
                by_id[row["id"]] = row
    if readable == 0:
        return None
    return sorted(by_id.values(), key=lambda row: (row["createdAt"], row["id"]), reverse=True)


# ── Transport ───────────────────────────────────────────────────────────────

def post(api_url: str, token: str, etype: str, payload: Dict[str, Any]) -> bool:
    """POST one event. True on 2xx. Logs the status, never the token."""
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/events",
        data=json.dumps({"type": etype, "payload": payload}).encode(),
        headers={"content-type": "application/json", "x-ingest-token": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        hint = " (INGEST_TOKEN mismatch with the api?)" if e.code == 401 else ""
        log(f"{etype}: HTTP {e.code}{hint}")
    except urllib.error.URLError as e:
        log(f"{etype}: api unreachable at {api_url} ({e.reason})")
    return False


def strip_private(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop our internal `_…` helper keys before sending."""
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]


# ── Main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="OpenClaw → Mission Control bridge (one sync per run)")
    ap.add_argument("--dry-run", action="store_true", help="print events as JSON lines; post nothing")
    ap.add_argument("--from-dir", type=Path, help="read <dir>/{agents,sessions,cron,approvals}.json instead of the CLI")
    ap.add_argument(
        "--memory-dir",
        type=Path,
        help="read an OpenClaw memory tree (one workspace, or one subdirectory per agent)",
    )
    args = ap.parse_args()

    # Repo-root .env is the single source of truth for INGEST_TOKEN (same file
    # docker compose reads). Real env vars override it.
    load_dotenv(REPO_ROOT / ".env")
    api_url = os.environ.get("MC_API_URL", DEFAULT_API_URL)
    token = os.environ.get("INGEST_TOKEN", "")
    if not token and not args.dry_run:
        # Compose falls back to `dev-ingest-token` when .env leaves it blank;
        # we deliberately do NOT guess — an explicit token avoids silent 401s.
        log("INGEST_TOKEN is not set (env or repo-root .env) — refusing to post")
        return 2

    src = Sources(args.from_dir)
    now_ms = int(time.time() * 1000)
    events: List[Tuple[str, Dict[str, Any]]] = []

    sessions_rows = as_list(src.sessions(), "sessions")
    sessions = map_sessions(sessions_rows, now_ms) if sessions_rows is not None else None

    agents_rows = as_list(src.agents(), "agents")
    if agents_rows is not None:
        events.append(("agents.snapshot", {"agents": map_agents(agents_rows, sessions or [])}))
    if sessions is not None:
        events.append(("sessions.snapshot", {"sessions": strip_private(sessions)}))

    cron_rows = as_list(src.cron(), "jobs", "cron")
    state_file = Path(os.environ.get("MC_BRIDGE_STATE_FILE", DEFAULT_STATE_FILE))
    state: Dict[str, Any] = {}
    if cron_rows is not None:
        events.append(("calendar.snapshot", {"jobs": map_cron(cron_rows)}))
        try:
            state = json.loads(state_file.read_text()) if state_file.is_file() else {}
        except (OSError, json.JSONDecodeError):
            state = {}
        events.extend(cron_run_events(cron_rows, state))

    if sessions is not None:
        for period, window_ms in USAGE_WINDOWS:
            events.append(("usage.snapshot", usage_from_sessions(sessions, now_ms, period, window_ms)))
        events.append(("usage.snapshot", usage_from_sessions(sessions, now_ms, "month")))

    approvals_rows = as_list(src.approvals(), "approvals")
    if approvals_rows is not None:
        events.append(("approvals.snapshot", {"approvals": [
            {"kind": str(a.get("kind", "exec")), "tag": str(a.get("tag", "Request")),
             "desc": str(a.get("desc", "")), "meta": a.get("meta")}
            for a in approvals_rows
        ]}))

    # Memory is its own source. --memory-dir is a sample (or explicit) tree.
    # Otherwise use workspace paths from `openclaw agents list --json`.
    # Unreadable workspaces skip the event so a broken path cannot wipe notes.
    memory_entries: Optional[List[Dict[str, Any]]] = None
    if args.memory_dir is not None:
        mem_agents = agents_from_memory_dir(args.memory_dir)
        if mem_agents is None:
            log(f"memory dir {args.memory_dir} not found — skipping memory.snapshot")
        else:
            memory_entries = collect_memory(mem_agents)
    elif agents_rows is not None:
        memory_entries = collect_memory(agents_rows, base=args.from_dir)
    if memory_entries is not None:
        events.append(("memory.snapshot", {"entries": memory_entries}))

    if not events:
        log("no OpenClaw sources available — nothing to post (dashboard data left untouched)")
        return 0

    if args.dry_run:
        for etype, payload in events:
            print(json.dumps({"type": etype, "payload": payload}))
        return 0  # dry-run never writes the state file either

    failures = sum(0 if post(api_url, token, t, p) else 1 for t, p in events)
    # Persist run-diff state only after a successful pass so a failed post
    # doesn't swallow run.* transitions.
    if cron_rows is not None and failures == 0:
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state))
    log(f"posted {len(events) - failures}/{len(events)} events to {api_url}/events")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
