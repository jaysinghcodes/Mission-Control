#!/usr/bin/env python3
"""
mc-bridge-sync.py: minimal OpenClaw to Mission Control bridge (ticket 2).

Vendored into the repo so a fresh clone ships with the integration piece.
It used to live only on the operator's box at ~/.openclaw/.mc-bridge-sync.py.

ONE RUN = collect OpenClaw state once, POST it, exit. Schedule it every ~5 min
(system cron or an OpenClaw cron job). See bridge/README.md.

  collect                                 POST /events (x-ingest-token)
  ───────────────────────────────────     ─────────────────────────────
  openclaw agents list --json to agents.snapshot
  openclaw sessions --all-agents --json to sessions.snapshot
  openclaw cron list --all --json to calendar.snapshot
                                          + run.* for job-state changes
                                          + POST /runs and PATCH /runs/:id
                                            (ticketId when the job has one)
  (derived from sessions token counts) to usage.snapshot (daily points, up to 30 days)
  ~/.openclaw/openclaw.json               models.snapshot
    (fallback: openclaw models list)
  openclaw devices list --json            devices.snapshot devices
  openclaw nodes list --json              devices.snapshot nodes
  TCP connect to 127.0.0.1                gateway.snapshot
    (OPENCLAW_GATEWAY_PORT or 18789)
  $MC_BRIDGE_APPROVALS_CMD (optional) to approvals.snapshot
  agent workspace MEMORY.md + memory/*.md to memory.snapshot

Design rules (why the code looks the way it does):
  * stdlib only. Runs under any python3 >= 3.8 with zero installs.
  * NEVER WIPE ON FAILURE. Most snapshots replace a table on the API side.
    usage.snapshot does not: it upserts daily points and leaves other days
    alone. If a source is unavailable (no `openclaw` on PATH, non-zero exit,
    bad JSON) that snapshot is SKIPPED, not sent empty. Otherwise a broken
    bridge would erase the dashboard (or the demo seed). An instance that
    genuinely has zero items still posts [].
  * run.* events are emitted only on CHANGE, using a small state file, so the
    activity feed is not flooded with duplicates every 5 minutes.
  * A 404 for an unknown ticketId on POST /runs or PATCH /runs is retried
    once without ticketId. The run is still recorded. The token is not logged.
  * POST /runs clips name to 200 characters and agent to 100, counting
    Unicode code points, so a long OpenClaw name still records a run.
  * One failed run does not block saving state for the runs that succeeded.
  * Secrets: INGEST_TOKEN comes from the environment or the repo-root .env.
    It is sent only as the x-ingest-token header and is NEVER printed, even
    with --dry-run.
  * LIGHT ON A 1 CORE VM (#118). A steady state run starts `openclaw` once,
    for sessions. Agents, cron, devices, nodes, the models list, and the
    CLI version are cached in MC_BRIDGE_CACHE_FILE and fetched again when
    openclaw.json changes, a value is missing, the sessions call fails, or
    MC_BRIDGE_REFRESH_SECONDS (default 3600) pass. Memory files are reused
    by mtime and size. A cached run posts the same bytes as a full run.
    --profile prints time, CPU and peak memory with children, and calls.
  * MC_BRIDGE_REGISTER=1 also POSTs /agents/register for each mapped agent.
    Leave it unset and this script only posts agents.snapshot. OpenClaw
    stays optional either way.

Usage:
  python3 bridge/mc-bridge-sync.py              # collect + post
  python3 bridge/mc-bridge-sync.py --dry-run    # collect + print payloads, post nothing
  python3 bridge/mc-bridge-sync.py --profile    # also print time, CPU, memory and openclaw calls
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
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

# ── Paths / config ──────────────────────────────────────────────────────────

BRIDGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BRIDGE_DIR.parent

# Loopback by default. Same posture as the api (binds 127.0.0.1).
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


# Every `openclaw` call this run, by its arguments. --profile prints it.
OPENCLAW_CALLS: Dict[str, int] = {}


def run_cli(
    argv: List[str],
    timeout: int,
    env: Optional[Dict[str, str]] = None,
    cwd: Optional[str] = None,
) -> "subprocess.CompletedProcess[str]":
    """subprocess.run for a source command. Counts each `openclaw` call."""
    if argv and os.path.basename(argv[0]) == "openclaw":
        key = " ".join(argv[1:])
        OPENCLAW_CALLS[key] = OPENCLAW_CALLS.get(key, 0) + 1
    return subprocess.run(
        argv, capture_output=True, text=True, timeout=timeout, env=env, cwd=cwd
    )


def _valid_port(raw: str) -> Optional[int]:
    text = raw.strip()
    if not text.isdigit():
        return None
    port = int(text)
    if port < 1 or port > 65535:
        return None
    return port


def default_api_url() -> str:
    """API base used when MC_API_URL is unset.

    MC_API_PORT is the Compose host port, so it wins when it is set.
    Otherwise PORT is the native listen port. The last resort is port 3000.
    """
    explicit = os.environ.get("MC_API_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    published = _valid_port(os.environ.get("MC_API_PORT", ""))
    if published is not None:
        return f"http://127.0.0.1:{published}"
    listen = _valid_port(os.environ.get("PORT", ""))
    if listen is not None:
        return f"http://127.0.0.1:{listen}"
    return DEFAULT_API_URL


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


# OpenClaw prints `GIT_COMMIT` or `GIT_SHA` from its environment in place of
# its own build commit. Mission Control uses GIT_SHA for its own commit, so
# every OpenClaw command runs without both. The System page then shows what
# `openclaw --version` prints on the host.
OPENCLAW_ENV_DROP = ("GIT_SHA", "GIT_COMMIT")


def openclaw_env() -> Dict[str, str]:
    """os.environ without GIT_SHA and GIT_COMMIT."""
    return {k: v for k, v in os.environ.items() if k not in OPENCLAW_ENV_DROP}


def openclaw_cwd() -> Optional[str]:
    """Home, so OpenClaw never reads this checkout's .git for its commit."""
    try:
        home = Path.home()
    except (KeyError, RuntimeError):
        return None
    return str(home) if home.is_dir() else None


# ── Sources ─────────────────────────────────────────────────────────────────

class Sources:
    """
    Where raw OpenClaw data comes from. Two modes:
      * CLI (default): shell out to `openclaw … --json`.
      * --from-dir DIR: read DIR/{agents,sessions,cron,approvals,devices,nodes}.json.
        Used for testing the mapping without an OpenClaw install (see bridge/examples).
    Every getter returns parsed JSON or None (meaning the source is unavailable, so skip).
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
            log(f"{p}: bad JSON ({e}). Skipping it.")
            return None

    def _cli(self, argv: List[str]) -> Optional[Any]:
        """Run a command expected to print JSON. Never raises."""
        try:
            proc = run_cli(argv, 60, env=openclaw_env())
        except FileNotFoundError:
            log(f"`{argv[0]}` not found on PATH. Skipping {' '.join(argv[1:3])}.")
            return None
        except subprocess.TimeoutExpired:
            log(f"`{' '.join(argv)}` timed out. Skipping it.")
            return None
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout).strip().splitlines()[-1:] or ["(no output)"]
            log(f"`{' '.join(argv)}` exited {proc.returncode}: {tail[0][:200]}. Skipping it.")
            return None
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            log(f"`{' '.join(argv)}` did not print JSON. Skipping it.")
            return None

    def agents(self) -> Optional[Any]:
        return self._file("agents") if self.from_dir else self._cli(["openclaw", "agents", "list", "--json"])

    def sessions(self) -> Optional[Any]:
        if self.from_dir:
            return self._file("sessions")
        return self._cli(["openclaw", "sessions", "--all-agents", "--json"])

    def cron(self) -> Optional[Any]:
        return self._file("cron") if self.from_dir else self._cli(["openclaw", "cron", "list", "--all", "--json"])

    def devices(self) -> Optional[Any]:
        return self._file("devices") if self.from_dir else self._cli(["openclaw", "devices", "list", "--json"])

    def nodes(self) -> Optional[Any]:
        """Paired and pending nodes. Live `connected` comes from the list.

        When the list has rows and none carry a boolean `connected`, also
        read `openclaw nodes status --json` and copy that flag across.
        `--from-dir` never shells out.
        """
        if self.from_dir:
            return self._file("nodes")
        listed = self._cli(["openclaw", "nodes", "list", "--json"])
        if listed is None:
            return None
        if nodes_missing_connected(listed):
            status = self._cli(["openclaw", "nodes", "status", "--json"])
            if status is not None:
                return overlay_node_status(listed, status)
        return listed

    def approvals(self) -> Optional[Any]:
        """
        OpenClaw has no stable "pending approvals" list command yet, so this is
        opt-in: set MC_BRIDGE_APPROVALS_CMD to any command that prints a JSON
        array (or {approvals:[…]}) of {kind, tag, desc, meta?}. Unset means skip,
        which PRESERVES whatever approvals Mission Control already has.
        """
        if self.from_dir:
            return self._file("approvals")
        cmd = os.environ.get("MC_BRIDGE_APPROVALS_CMD", "").strip()
        return self._cli(shlex.split(cmd)) if cmd else None

    def model_catalog(self) -> Optional[List[Dict[str, str]]]:
        """`openclaw models list` when the config file has no agent models.

        `--json` first. Plain stdout is one model key per line. `--from-dir`
        never shells out, so a fixture run cannot pick up a real install.
        """
        if self.from_dir:
            return None
        raw = self._cli(["openclaw", "models", "list", "--json"])
        if raw is not None:
            rows = models_from_list_payload(raw)
            if rows:
                return rows
        text = self._models_list_text()
        if text is None:
            return None
        return models_from_list_text(text) or None

    def _models_list_text(self) -> Optional[str]:
        try:
            proc = run_cli(["openclaw", "models", "list"], 60, env=openclaw_env())
        except FileNotFoundError:
            log("`openclaw` not found on PATH. Skipping models list")
            return None
        except subprocess.TimeoutExpired:
            log("`openclaw models list` timed out. Skipping")
            return None
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout).strip().splitlines()[-1:] or ["(no output)"]
            log(f"`openclaw models list` exited {proc.returncode}: {tail[0][:200]}. Skipping")
            return None
        return proc.stdout


def as_list(raw: Any, *keys: str) -> Optional[List[Dict[str, Any]]]:
    """
    Normalize OpenClaw's --json list envelopes (they differ per command, see
    openclaw/openclaw#77943): bare array, or {<key>: [...]}, or {items: [...]}.
    Returns None if the shape is unrecognized (so skip, never wipe).
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


def _clip(value: Any, limit: int) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()[:limit]


def _iso_ms(ms: Optional[int]) -> Optional[str]:
    if ms is None:
        return None
    try:
        return datetime.datetime.fromtimestamp(
            ms / 1000, datetime.timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    except (OverflowError, OSError, ValueError):
        return None


def _dicts(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def split_pair_payload(
    raw: Any,
) -> Optional[Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Optional[List[Dict[str, Any]]]]]:
    """(paired, pending, nodes catalog) or None when the shape is not a list."""
    if isinstance(raw, list):
        return (_dicts(raw), [], None)
    if not isinstance(raw, dict):
        return None
    has_pair = isinstance(raw.get("paired"), list) or isinstance(raw.get("pending"), list)
    has_nodes = isinstance(raw.get("nodes"), list)
    if not has_pair and not has_nodes:
        return None
    catalog = _dicts(raw.get("nodes")) if has_nodes else None
    paired = _dicts(raw.get("paired")) if isinstance(raw.get("paired"), list) else []
    pending = _dicts(raw.get("pending")) if isinstance(raw.get("pending"), list) else []
    return (paired, pending, catalog)


def nodes_missing_connected(raw: Any) -> bool:
    parsed = split_pair_payload(raw)
    if parsed is None:
        return False
    paired, _pending, catalog = parsed
    rows = catalog if catalog is not None else paired
    if not rows:
        return False
    return not any(isinstance(row.get("connected"), bool) for row in rows)


def overlay_node_status(listed: Any, status: Any) -> Any:
    """Copy live connection fields from nodes status onto a nodes list."""
    parsed = split_pair_payload(status)
    if parsed is None or not isinstance(listed, dict):
        return listed
    paired, _pending, catalog = parsed
    live_rows = catalog if catalog is not None else paired
    by_id: Dict[str, Dict[str, Any]] = {}
    for row in live_rows:
        nid = _clip(first(row, "nodeId", "deviceId", "id"), 200)
        if nid:
            by_id[nid] = row
    if not by_id:
        return listed

    def paint(items: Any) -> Any:
        if not isinstance(items, list):
            return items
        out: List[Any] = []
        for item in items:
            if not isinstance(item, dict):
                out.append(item)
                continue
            nid = _clip(first(item, "nodeId", "deviceId", "id"), 200)
            live = by_id.get(nid)
            if not live:
                out.append(item)
                continue
            nxt = dict(item)
            if isinstance(live.get("connected"), bool):
                nxt["connected"] = live["connected"]
            for key in ("connectedAtMs", "lastConnectedAtMs", "platform", "displayName"):
                if nxt.get(key) in (None, "") and live.get(key) not in (None, ""):
                    nxt[key] = live[key]
            out.append(nxt)
        return out

    merged = dict(listed)
    if isinstance(merged.get("paired"), list):
        merged["paired"] = paint(merged["paired"])
    if isinstance(merged.get("nodes"), list):
        merged["nodes"] = paint(merged["nodes"])
    return merged


def _device_type(row: Dict[str, Any]) -> str:
    roles = row.get("roles")
    if isinstance(roles, list):
        for role in roles:
            text = _clip(role, 80)
            if text:
                return text
    role = _clip(row.get("role"), 80)
    return role or "device"


def _node_type(row: Dict[str, Any]) -> str:
    platform = _clip(first(row, "platform", "deviceFamily"), 80)
    return platform or "node"


def _machine_name(row: Dict[str, Any], fallback: str) -> str:
    name = _clip(first(row, "operatorLabel", "displayName", "name", "clientId"), 200)
    return name or fallback


def _pending_id(row: Dict[str, Any], live_ids: Set[str]) -> Optional[str]:
    raw_id = _clip(first(row, "deviceId", "nodeId", "id"), 200)
    if raw_id and raw_id in live_ids:
        return None
    token = _clip(first(row, "requestId", "id"), 180) or raw_id
    if not token:
        return None
    pid = token if token.startswith("pending:") else f"pending:{token}"
    if len(pid) > 200 or pid.startswith("demo-") or pid in live_ids:
        return None
    return pid


def _connection_fields(item: Dict[str, Any], pending: bool) -> Dict[str, Any]:
    """Online only from a real connection. Pairing time is never last seen.

    `connected: true` is online, and lastSeenAt is then empty. A last seen
    field (lastSeenAt, lastConnectedAtMs, connectedAtMs) is lastSeenAt only
    while the machine is not online. approvedAtMs and pairedAt are pairedAt.
    A pending request uses requestedAt and is not online.
    """
    if pending:
        requested = to_ms(
            first(item, "requestedAtMs", "requestedAt", "ts", "createdAtMs")
        )
        return {
            "online": False,
            "lastSeenAt": None,
            "pairedAt": None,
            "requestedAt": _iso_ms(requested),
        }
    online = item.get("connected") is True
    seen = to_ms(
        first(
            item,
            "lastSeenAtMs",
            "lastSeenAt",
            "lastConnectedAtMs",
            "connectedAtMs",
        )
    )
    paired = to_ms(
        first(item, "pairedAtMs", "pairedAt", "approvedAtMs", "createdAtMs")
    )
    return {
        "online": online,
        "lastSeenAt": None if online else _iso_ms(seen),
        "pairedAt": _iso_ms(paired),
        "requestedAt": None,
    }


def map_openclaw_devices(raw: Any) -> Optional[List[Dict[str, Any]]]:
    """Paired and pending devices, or None when the payload is not a list.

    A paired row with no connected flag and no last seen field is paired,
    not online. approvedAtMs is pairedAt, never lastSeenAt.
    """
    parsed = split_pair_payload(raw)
    if parsed is None:
        return None
    paired, pending, _catalog = parsed
    rows: Dict[str, Dict[str, Any]] = {}
    for item in paired:
        did = _clip(first(item, "deviceId", "id"), 200)
        if not did or did.startswith("demo-"):
            continue
        rows[did] = {
            "id": did,
            "name": _machine_name(item, did),
            "type": _device_type(item),
            **_connection_fields(item, False),
        }
    for item in pending:
        pid = _pending_id(item, set(rows))
        if not pid:
            continue
        label = _clip(first(item, "deviceId", "id"), 200) or pid
        rows[pid] = {
            "id": pid,
            "name": _machine_name(item, label),
            "type": "pending",
            **_connection_fields(item, True),
        }
    return list(rows.values())


def map_openclaw_nodes(raw: Any) -> Optional[List[Dict[str, Any]]]:
    """Paired and pending nodes, or None when the payload is not a list.

    `connected: true` is online. A missing flag stays offline. lastSeenAt
    comes from a last seen field, not from approvedAtMs.
    """
    parsed = split_pair_payload(raw)
    if parsed is None:
        return None
    paired, pending, catalog = parsed
    live = catalog if catalog is not None else paired
    rows: Dict[str, Dict[str, Any]] = {}
    for item in live:
        nid = _clip(first(item, "nodeId", "deviceId", "id"), 200)
        if not nid or nid.startswith("demo-"):
            continue
        rows[nid] = {
            "id": nid,
            "name": _machine_name(item, nid),
            "type": _node_type(item),
            **_connection_fields(item, False),
        }
    for item in pending:
        pid = _pending_id(item, set(rows))
        if not pid:
            continue
        label = _clip(first(item, "nodeId", "deviceId", "id"), 200) or pid
        rows[pid] = {
            "id": pid,
            "name": _machine_name(item, label),
            "type": "pending",
            **_connection_fields(item, True),
        }
    return list(rows.values())


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


# ── Mapping: OpenClaw JSON to Mission Control snapshot payloads ──────────────
# Output shapes are dictated by apps/api/src/snapshots/snapshots.service.ts.

def price_model(provider: Any, model: Any) -> Optional[str]:
    """The usage model name the API prices: provider/model.

    OpenClaw reports `modelProvider` and often a bare `model`, for example
    deepseek and deepseek-v4-flash. That becomes deepseek/deepseek-v4-flash.
    A run through a router keeps the router in front, so openrouter with
    deepseek/deepseek-v4-flash becomes openrouter/deepseek/deepseek-v4-flash
    and is charged the OpenRouter row. A name that already starts with the
    provider is kept as is. With no provider the model is kept as is.
    """
    if not isinstance(model, str) or not model.strip():
        return model if isinstance(model, str) else None
    text = model.strip()
    prov = provider.strip() if isinstance(provider, str) else ""
    if not prov:
        return text
    if text.lower().startswith(prov.lower() + "/"):
        return text
    return f"{prov}/{text}"


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
            # Usage prices this name. The session row above keeps the model as OpenClaw sent it.
            "_priceModel": price_model(first(s, "modelProvider", "provider"), first(s, "model")),
            "_in": first(s, "inputTokens") or 0,
            "_out": first(s, "outputTokens") or 0,
            # None when the session did not report a cost. Zero is a real report.
            "_cost": _optional_cost(first(s, "costUsd", "estimatedCostUsd", "cost")),
        })
    return out


def agent_slug(raw: str) -> str:
    """Lowercase slug, 1 to 64 characters: a to z, 0 to 9, underscores."""
    text = re.sub(r"[^a-z0-9]+", "_", str(raw or "").strip().lower())
    text = re.sub(r"_+", "_", text).strip("_")[:64].strip("_")
    return text or "agent"


def unique_agent_slug(base: str, used: Set[str]) -> str:
    slug = agent_slug(base)
    if slug not in used:
        used.add(slug)
        return slug
    n = 2
    while n < 1000:
        suffix = f"_{n}"
        cut = slug[: 64 - len(suffix)].rstrip("_")
        candidate = f"{cut}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        n += 1
    used.add(slug)
    return slug


def config_path_for(from_dir: Optional[Path]) -> Optional[Path]:
    """Config file for models.snapshot.

    `--from-dir` reads only `<dir>/openclaw.json`. CLI mode uses
    OPENCLAW_CONFIG_PATH, then ~/.openclaw/openclaw.json.
    """
    if from_dir is not None:
        candidate = from_dir / "openclaw.json"
        return candidate if candidate.is_file() else None
    override = os.environ.get("OPENCLAW_CONFIG_PATH", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".openclaw" / "openclaw.json"


def parse_config_json(text: str) -> Any:
    """JSON, or JSON with comments and trailing commas (OpenClaw writes JSON5)."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return json.loads(strip_json5(text))


def strip_json5(text: str) -> str:
    """Drop // and /* */ comments outside strings, then trailing commas."""
    out: List[str] = []
    i = 0
    n = len(text)
    in_str = False
    quote = ""
    escaped = False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                in_str = False
            i += 1
            continue
        if ch in "\"'":
            in_str = True
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            i += 2
            while i < n and text[i] not in "\n\r":
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i = min(n, i + 2)
            continue
        out.append(ch)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def read_openclaw_config(path: Path) -> Optional[Dict[str, Any]]:
    """Parsed config object, or None when the file cannot be used.

    None means skip the snapshot. A readable file with no models is an
    empty object from models_from_config, not None here.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        log(f"could not read {path} ({exc}). Skipping models.snapshot")
        return None
    try:
        raw = parse_config_json(text)
    except (json.JSONDecodeError, ValueError) as exc:
        log(f"{path} is not JSON ({exc}). Skipping models.snapshot")
        return None
    if not isinstance(raw, dict):
        log(f"{path} is not a JSON object. Skipping models.snapshot")
        return None
    return raw


def local_provider_names(cfg: Optional[Dict[str, Any]]) -> Set[str]:
    """Ollama, plus any provider the config marks local or talks to with the ollama API."""
    names = {"ollama"}
    if not isinstance(cfg, dict):
        return names
    models = cfg.get("models") if isinstance(cfg.get("models"), dict) else {}
    providers = models.get("providers") if isinstance(models.get("providers"), dict) else None
    if providers is None and isinstance(cfg.get("providers"), dict):
        providers = cfg["providers"]
    if not isinstance(providers, dict):
        return names
    for name, body in providers.items():
        key = str(name).strip().lower()
        if not key or not isinstance(body, dict):
            continue
        if body.get("local") is True:
            names.add(key)
        api = body.get("api")
        if isinstance(api, str) and api.strip().lower() == "ollama":
            names.add(key)
    return names


def _flag_local(row: Dict[str, Any], names: Set[str]) -> None:
    provider = str(row.get("provider") or "").strip().lower()
    row["local"] = provider in names


def split_model_ref(ref: str) -> Optional[Tuple[str, str]]:
    """`provider/model`. The model id may itself contain slashes."""
    text = ref.strip()
    if not text or "/" not in text or "*" in text:
        return None
    provider, model = text.split("/", 1)
    provider = provider.strip()
    model = model.strip()
    if not provider or not model:
        return None
    return provider, model


def model_primary(value: Any) -> Optional[str]:
    """String ref, or `{primary}` from agents.defaults.model / entries.*.model."""
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        primary = value.get("primary")
        if isinstance(primary, str) and primary.strip():
            return primary.strip()
    return None


def agent_display_name(entry: Dict[str, Any], fallback: str) -> str:
    identity = entry.get("identity")
    if isinstance(identity, dict):
        named = identity.get("name")
        if isinstance(named, str) and named.strip():
            return named.strip()
    for key in ("name", "identityName"):
        named = entry.get(key)
        if isinstance(named, str) and named.strip():
            return named.strip()
    return fallback


def _agent_model_row(
    agent_id: str,
    entry: Dict[str, Any],
    default_ref: Optional[str],
    used: Set[str],
) -> Optional[Dict[str, str]]:
    ref = model_primary(entry.get("model")) or default_ref
    parsed = split_model_ref(ref) if ref else None
    if not parsed:
        return None
    provider, model = parsed
    return {
        "id": unique_agent_slug(agent_id, used),
        "name": agent_display_name(entry, agent_id),
        "provider": provider,
        "model": model,
    }


def models_from_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Per agent provider and model, plus meta.lastTouchedVersion when set."""
    agents_root = cfg.get("agents") if isinstance(cfg.get("agents"), dict) else {}
    defaults = agents_root.get("defaults") if isinstance(agents_root.get("defaults"), dict) else {}
    default_ref = model_primary(defaults.get("model"))
    used: Set[str] = set()
    rows: List[Dict[str, str]] = []
    entries = agents_root.get("entries")
    if isinstance(entries, dict) and entries:
        for agent_id, entry in entries.items():
            body = entry if isinstance(entry, dict) else {}
            row = _agent_model_row(str(agent_id), body, default_ref, used)
            if row:
                rows.append(row)
    else:
        listing = agents_root.get("list")
        if isinstance(listing, list):
            for entry in listing:
                if not isinstance(entry, dict):
                    continue
                agent_id = str(entry.get("id") or entry.get("name") or "agent")
                row = _agent_model_row(agent_id, entry, default_ref, used)
                if row:
                    rows.append(row)
    if not rows and default_ref:
        row = _agent_model_row("main", {}, default_ref, used)
        if row:
            rows.append(row)
    names = local_provider_names(cfg)
    for row in rows:
        _flag_local(row, names)
    version = None
    meta = cfg.get("meta")
    if isinstance(meta, dict):
        for key in ("lastTouchedVersion", "version"):
            raw = meta.get(key)
            if isinstance(raw, str) and raw.strip():
                version = raw.strip()[:80]
                break
    return {"agents": rows, "models": [], "openclawVersion": version}


def models_from_list_payload(raw: Any) -> List[Dict[str, str]]:
    """Rows from `openclaw models list --json`."""
    items: Optional[List[Any]] = None
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        for key in ("models", "items", "available"):
            if isinstance(raw.get(key), list):
                items = raw[key]
                break
    if items is None:
        return []
    out: List[Dict[str, str]] = []
    seen: Set[Tuple[str, str]] = set()
    for item in items:
        parsed: Optional[Tuple[str, str]] = None
        if isinstance(item, str):
            parsed = split_model_ref(item)
        elif isinstance(item, dict):
            provider = item.get("provider")
            model = item.get("model")
            if isinstance(provider, str) and isinstance(model, str):
                provider = provider.strip()
                model = model.strip()
                if provider and model and "*" not in model:
                    parsed = (provider, model)
            if parsed is None:
                ref = item.get("key") or item.get("ref") or item.get("id") or item.get("name")
                if isinstance(ref, str):
                    parsed = split_model_ref(ref)
                if parsed is None and isinstance(provider, str) and isinstance(item.get("id"), str):
                    ident = str(item["id"]).strip()
                    if provider.strip() and ident and "/" not in ident and "*" not in ident:
                        parsed = (provider.strip(), ident)
        if not parsed or parsed in seen:
            continue
        seen.add(parsed)
        out.append({"provider": parsed[0], "model": parsed[1]})
    return out


def models_from_list_text(text: str) -> List[Dict[str, str]]:
    """Plain `openclaw models list`: one model key per line, first token."""
    out: List[Dict[str, str]] = []
    seen: Set[Tuple[str, str]] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parsed = split_model_ref(stripped.split()[0])
        if not parsed or parsed in seen:
            continue
        seen.add(parsed)
        out.append({"provider": parsed[0], "model": parsed[1]})
    return out


def version_line(text: str) -> Optional[str]:
    line = text.strip().splitlines()[0].strip() if text.strip() else ""
    return line[:80] or None


def gateway_listen_port() -> int:
    """Port the host gateway listens on. Blank or invalid uses 18789."""
    raw = os.environ.get("OPENCLAW_GATEWAY_PORT", "").strip()
    if raw.isdigit():
        port = int(raw)
        if 1 <= port <= 65535:
            return port
    return 18789


def probe_gateway(version_of: Optional[Callable[[], Optional[str]]] = None) -> Dict[str, Any]:
    """TCP check of the gateway on this machine. The bridge runs on the host.

    Stock OpenClaw listens on 127.0.0.1, which a container cannot reach.
    A refused connection is down. A version is included when the CLI prints one.
    """
    host = "127.0.0.1"
    port = gateway_listen_port()
    started = time.monotonic()
    up = False
    try:
        with socket.create_connection((host, port), timeout=0.8):
            up = True
    except OSError:
        up = False
    payload: Dict[str, Any] = {
        "up": up,
        "host": host,
        "port": port,
        "checkedAt": int(time.time() * 1000),
        "latencyMs": int((time.monotonic() - started) * 1000) if up else None,
    }
    version = version_of() if version_of is not None else openclaw_cli_version()
    if version:
        payload["version"] = version
    return payload


def openclaw_cli_version() -> Optional[str]:
    """First line of `openclaw --version`, or None when the CLI is missing.

    Runs without GIT_SHA and GIT_COMMIT, from home, so the line is exactly
    what the binary prints on the host. Mission Control's own commit is
    never mixed in.
    """
    try:
        proc = run_cli(
            ["openclaw", "--version"], 20, env=openclaw_env(), cwd=openclaw_cwd()
        )
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        log("`openclaw --version` timed out")
        return None
    if proc.returncode != 0:
        return None
    return version_line(proc.stdout or proc.stderr)


def collect_models(
    src: Sources,
    from_dir: Optional[Path],
    catalog_of: Optional[Callable[[], Optional[List[Dict[str, str]]]]] = None,
    version_of: Optional[Callable[[], Optional[str]]] = None,
) -> Optional[Dict[str, Any]]:
    """models.snapshot payload, or None when the source was not readable.

    A readable config with no models, and no CLI list, still returns empty
    arrays so the dashboard can show that nothing is configured. A missing
    file plus a missing CLI skips the event and leaves the previous rows.
    """
    path = config_path_for(from_dir)
    file_ok = False
    cfg: Optional[Dict[str, Any]] = None
    payload: Dict[str, Any]
    if path is not None and path.is_file():
        cfg = read_openclaw_config(path)
        if cfg is None:
            return None
        file_ok = True
        payload = models_from_config(cfg)
    elif from_dir is not None:
        return None
    else:
        payload = {"agents": [], "models": [], "openclawVersion": None}
    if not payload["agents"]:
        listed = catalog_of() if catalog_of is not None else src.model_catalog()
        if listed:
            payload["models"] = listed
        elif not file_ok:
            return None
    if from_dir is None:
        version = version_of() if version_of is not None else openclaw_cli_version()
        if version:
            payload["openclawVersion"] = version
    if not payload.get("openclawVersion"):
        payload.pop("openclawVersion", None)
    payload["models"] = payload.get("models") or []
    names = local_provider_names(cfg) if file_ok else {"ollama"}
    for row in list(payload["agents"]) + list(payload["models"]):
        if isinstance(row, dict):
            _flag_local(row, names)
    return {
        "agents": payload["agents"],
        "models": payload["models"],
        **({"openclawVersion": payload["openclawVersion"]} if payload.get("openclawVersion") else {}),
    }


def wants_self_register() -> bool:
    """Optional. Unset means the bridge only posts agents.snapshot."""
    return os.environ.get("MC_BRIDGE_REGISTER", "").strip().lower() in {"1", "true", "yes"}


def register_payloads(agents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Bodies for POST /agents/register. Name is clipped to 200 code points."""
    out = []
    for agent in agents:
        body: Dict[str, Any] = {
            "id": str(agent.get("id") or agent_slug(str(agent.get("name") or "agent"))),
            "name": _clip_chars(str(agent.get("name") or "agent"), RUN_NAME_MAX),
        }
        role = agent.get("role")
        if isinstance(role, str) and role.strip():
            body["role"] = _clip_chars(role, RUN_NAME_MAX)
        emoji = agent.get("emoji")
        if isinstance(emoji, str) and emoji.strip():
            body["avatar"] = _clip_chars(emoji, RUN_NAME_MAX)
        out.append(body)
    return out


def map_agents(rows: List[Dict[str, Any]], sessions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agent tree: the default agent (isDefault / id 'main') is the root; every
    other agent hangs under it unless OpenClaw names an explicit parent.
    `status` is derived: 'working' if the agent has a hot session.
    `id` is a stable lowercase slug so a later snapshot updates the same row.
    """
    hot_agents = {s["agent"] for s in sessions if s["hot"]}
    root = next((a for a in rows if a.get("isDefault")), None) or next(
        (a for a in rows if a.get("id") == "main"), None)

    def display(a: Dict[str, Any]) -> str:
        return str(first(a, "identityName", "name", "id") or "agent")

    root_name = display(root) if root else None
    used: Set[str] = set()
    out = []
    for i, a in enumerate(rows):
        aid = str(first(a, "id", "name") or "")
        name = display(a)
        out.append({
            "id": unique_agent_slug(aid or name, used),
            "name": name,
            "role": first(a, "role") or aid or None,
            "color": first(a, "color") or AGENT_COLORS[i % len(AGENT_COLORS)],
            "status": "working" if aid in hot_agents else "idle",
            # Parent is sent as a NAME. SnapshotsService resolves it to an id.
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
        day = (int(dow) + 6) % 7  # cron 0/7=Sun,1=Mon maps to grid 0=Mon through 6=Sun
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
                label = f"every {mins}m"  # interval to all-day strip
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


def ticket_id_of(job: Dict[str, Any]) -> Optional[str]:
    """Mission Control ticket id when OpenClaw put one on the job. Otherwise None.

    A ticket key is not an id. Only a non blank string counts, so a missing
    field still produces a run with no link.
    """
    sources: List[Dict[str, Any]] = [job]
    meta = job.get("meta")
    if isinstance(meta, dict):
        sources.append(meta)
    for source in sources:
        for key in ("ticketId", "ticket_id"):
            raw = source.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw.strip()
    return None


# Same caps as POST /runs. Counted in Unicode code points, which is what
# Python str indexing already does and what the API checks with [...text].
RUN_NAME_MAX = 200
RUN_AGENT_MAX = 100


def _clip_chars(value: str, limit: int) -> str:
    """Trim, then keep the first `limit` code points. Empty stays empty."""
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[:limit]


def _run_create_body(name: str, agent: Any, ticket_id: Optional[str]) -> Dict[str, Any]:
    body: Dict[str, Any] = {"name": _clip_chars(name, RUN_NAME_MAX)}
    if isinstance(agent, str):
        clipped = _clip_chars(agent, RUN_AGENT_MAX)
        if clipped:
            body["agent"] = clipped
    if ticket_id:
        body["ticketId"] = ticket_id
    return body


def _with_ticket(body: Dict[str, Any], ticket_id: Optional[str]) -> Dict[str, Any]:
    if not ticket_id:
        return body
    out = dict(body)
    out["ticketId"] = ticket_id
    return out


def _event_payload(name: str, jid: str, agent: Any, ticket_id: Optional[str], **extra: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"name": name, "job": jid, "agent": agent}
    if ticket_id:
        payload["ticketId"] = ticket_id
    payload.update(extra)
    return payload


def cron_run_plan(
    rows: List[Dict[str, Any]],
    state: Dict[str, Any],
) -> Tuple[List[Tuple[str, Dict[str, Any]]], List[Dict[str, Any]]]:
    """
    Diff each job's run state against the previous bridge run.

    Events (unchanged contract):
      run.running:   job started running since last time
      run.completed: a new lastRunAtMs with status ok
      run.failed:    a new lastRunAtMs with status error
    First run for a job only records state (no backfill flood).

    Calls are the REST writes that store Run.ticketId:
      create: POST /runs, then PATCH to running or a terminal status
      patch:  PATCH /runs/:id when this job already has a run id
    ticketId is included only when OpenClaw knows it.

    Mutates `state` in place: {jobId: {running, lastRunAtMs, runId}}.
    """
    events: List[Tuple[str, Dict[str, Any]]] = []
    calls: List[Dict[str, Any]] = []
    for j in rows:
        jid = str(first(j, "id", "name") or "")
        if not jid:
            continue
        st = j.get("state") if isinstance(j.get("state"), dict) else {}
        running = bool(st.get("runningAtMs")) or j.get("status") == "running"
        last_at = to_ms(st.get("lastRunAtMs"))
        last_status = str(st.get("lastRunStatus") or st.get("lastStatus") or "")
        name = str(first(j, "name", "id"))
        agent = j.get("agentId")
        ticket_id = ticket_id_of(j)
        prev = state.get(jid) if isinstance(state.get(jid), dict) else None
        run_id = prev.get("runId") if isinstance(prev, dict) else None
        if isinstance(prev, dict):
            started = bool(running) and not prev.get("running")
            finished = bool(last_at) and last_at != prev.get("lastRunAtMs")
            ok = last_status in ("ok", "success", "done", "")
            terminal = "done" if ok else "failed"
            if started:
                events.append(("run.running", _event_payload("Run started", jid, agent, ticket_id, title=name)))
            if finished:
                phrase = "Run finished" if ok else "Run failed"
                events.append((
                    "run.completed" if ok else "run.failed",
                    _event_payload(phrase, jid, agent, ticket_id, title=name, status=last_status or "ok"),
                ))
            if finished and not started and run_id:
                calls.append({
                    "jobId": jid,
                    "op": "patch",
                    "runId": run_id,
                    "body": _with_ticket({"status": terminal, "progress": 100}, ticket_id),
                })
            elif finished and not started:
                calls.append({
                    "jobId": jid,
                    "op": "create",
                    "body": _run_create_body(name, agent, ticket_id),
                    "follow": _with_ticket({"status": terminal, "progress": 100}, ticket_id),
                })
            elif started and finished:
                if run_id:
                    calls.append({
                        "jobId": jid,
                        "op": "patch",
                        "runId": run_id,
                        "body": _with_ticket({"status": terminal, "progress": 100}, ticket_id),
                    })
                calls.append({
                    "jobId": jid,
                    "op": "create",
                    "body": _run_create_body(name, agent, ticket_id),
                    "follow": _with_ticket({"status": "running"}, ticket_id),
                })
            elif started:
                calls.append({
                    "jobId": jid,
                    "op": "create",
                    "body": _run_create_body(name, agent, ticket_id),
                    "follow": _with_ticket({"status": "running"}, ticket_id),
                })
        state[jid] = {"running": running, "lastRunAtMs": last_at, "runId": run_id}
    return events, calls


def cron_run_events(rows: List[Dict[str, Any]], state: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    """Event half of cron_run_plan. Prefer cron_run_plan when the REST calls matter."""
    events, _calls = cron_run_plan(rows, state)
    return events


# Session counters are cumulative. The first sync places each session on the
# calendar day of its last activity, up to USAGE_RETENTION_DAYS back (default
# 30), when that timestamp exists. Later syncs post only the increase, on the
# day of the sync. Sessions with no timestamp are collected on the sync day
# only. The day uses the timezone from GET /settings, then MC_TIMEZONE, then
# TZ, then the host zone named by the /etc/localtime symlink. The payload is daily points. It does not include a
# 7d or month total.
def usage_retention_days() -> int:
    """How many calendar days a usage payload may include. Default 30."""
    raw = os.environ.get("USAGE_RETENTION_DAYS", "").strip()
    if not raw:
        return 30
    try:
        count = int(raw)
    except ValueError:
        return 30
    if count < 1 or count > 3660:
        return 30
    return count


def _usage_num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _optional_cost(v: Any) -> Optional[float]:
    """A reported dollar amount, including zero. Missing and non numbers stay None."""
    if v is None or isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n:
        return None
    return n


def _iso_utc_ms(ms: int) -> str:
    dt = datetime.datetime.fromtimestamp(ms / 1000.0, datetime.timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _zone_day_ms(ms: int, tz: datetime.tzinfo) -> str:
    dt = datetime.datetime.fromtimestamp(ms / 1000.0, datetime.timezone.utc).astimezone(tz)
    return dt.date().isoformat()


def _shift_day(day: str, delta: int) -> str:
    year, month, date = (int(part) for part in day.split("-"))
    return (datetime.date(year, month, date) + datetime.timedelta(days=delta)).isoformat()


def _recent_days(today: str, n: Optional[int] = None) -> set:
    count = usage_retention_days() if n is None else n
    return {_shift_day(today, -i) for i in range(count)}


def _blank_usage_day(at_ms: int) -> Dict[str, Any]:
    return {"at": _iso_utc_ms(at_ms), "totalCost": 0.0, "tokensIn": 0, "tokensOut": 0, "providers": []}


def _split_model(model: str) -> Tuple[str, str]:
    text = model.strip()
    if "/" in text:
        provider, rest = text.split("/", 1)
        provider = provider.strip()
        rest = rest.strip()
        if provider and rest:
            return provider, text
    return text, text


def _line_has_cost(row: Dict[str, Any]) -> bool:
    value = row.get("costUsd")
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _add_usage_line(
    providers: List[Dict[str, Any]],
    bot: str,
    model: str,
    cost: Optional[float],
    tin: float,
    tout: float,
    local_names: Set[str],
) -> None:
    """Add one run.

    Rows merge only when both reported a cost or neither did. A costUsd
    covers that run alone. Tokens with no cost stay on their own row so the
    API can price them from the table and then add the reported cost.
    """
    if cost is None and tin == 0 and tout == 0:
        return
    if cost == 0 and tin == 0 and tout == 0:
        return
    provider, full_model = _split_model(model)
    local = provider.lower() in local_names
    incoming_has_cost = cost is not None
    for row in providers:
        if (
            row.get("model") == full_model
            and row.get("bot") == bot
            and _line_has_cost(row) == incoming_has_cost
        ):
            row["tokensIn"] = int(row.get("tokensIn") or 0) + int(tin)
            row["tokensOut"] = int(row.get("tokensOut") or 0) + int(tout)
            if cost is not None:
                prev = row.get("costUsd")
                base = float(prev) if isinstance(prev, (int, float)) and not isinstance(prev, bool) else 0.0
                row["costUsd"] = round(base + cost, 6)
            if local:
                row["local"] = True
            return
    line: Dict[str, Any] = {
        "name": provider,
        "provider": provider,
        "model": full_model,
        "bot": bot,
        "tokensIn": int(tin),
        "tokensOut": int(tout),
        "agents": [bot] if bot else [],
    }
    if cost is not None:
        line["costUsd"] = round(cost, 6)
    if local:
        line["local"] = True
    providers.append(line)


def _cost_delta(current: Optional[float], previous: Any) -> Optional[float]:
    if current is None:
        return None
    base = previous if isinstance(previous, (int, float)) and not isinstance(previous, bool) else 0.0
    return max(0.0, current - float(base))


def usage_points_from_sessions(
    sessions: List[Dict[str, Any]],
    now_ms: int,
    prior: Optional[Dict[str, Any]] = None,
    local_names: Optional[Set[str]] = None,
    tz: Optional[datetime.tzinfo] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Build `{points: [...]}` and the usage state to keep for the next run.

    `prior` is the `_mcUsage` object from the bridge state file, or None on
    the first connect. The returned payload has no period total. Days follow
    `tz` (the resolved zone when omitted). costUsd is omitted when the session
    did not report one.
    """
    prior = prior if isinstance(prior, dict) else {}
    names = local_names if local_names is not None else {"ollama"}
    zone = tz if tz is not None else resolve_tz()
    seen: Dict[str, Dict[str, Any]] = {}
    for key, value in (prior.get("seen") or {}).items():
        if isinstance(value, dict):
            raw_cost = value.get("cost")
            seen[str(key)] = {
                "cost": None if raw_cost is None else _usage_num(raw_cost),
                "in": _usage_num(value.get("in")),
                "out": _usage_num(value.get("out")),
            }
    days: Dict[str, Dict[str, Any]] = {}
    for key, value in (prior.get("days") or {}).items():
        if not isinstance(value, dict):
            continue
        days[str(key)] = {
            "at": str(value.get("at") or _iso_utc_ms(now_ms)),
            "totalCost": _usage_num(value.get("totalCost")),
            "tokensIn": int(_usage_num(value.get("tokensIn"))),
            "tokensOut": int(_usage_num(value.get("tokensOut"))),
            "providers": [dict(p) for p in (value.get("providers") or []) if isinstance(p, dict)],
        }
    started = bool(prior.get("started"))
    today = _zone_day_ms(now_ms, zone)
    allowed = _recent_days(today)

    def ensure(day: str, at_ms: int) -> Optional[Dict[str, Any]]:
        if day not in allowed:
            return None
        stamp = _iso_utc_ms(at_ms)
        bucket = days.get(day)
        if bucket is None:
            bucket = _blank_usage_day(at_ms)
            days[day] = bucket
        elif stamp > str(bucket.get("at") or ""):
            bucket["at"] = stamp
        return bucket

    def add(day: str, at_ms: int, bot: str, model: str, cost: Optional[float], tin: float, tout: float) -> None:
        bucket = ensure(day, at_ms)
        if bucket is None:
            return
        if cost is not None:
            bucket["totalCost"] = round(float(bucket["totalCost"]) + cost, 6)
        bucket["tokensIn"] = int(bucket["tokensIn"]) + int(tin)
        bucket["tokensOut"] = int(bucket["tokensOut"]) + int(tout)
        _add_usage_line(bucket["providers"], bot, model, cost, tin, tout, names)

    for s in sessions:
        name = str(s.get("name") or s.get("model") or "session")
        model = str(s.get("_priceModel") or s.get("model") or "unknown")
        bot = str(s.get("agent") or "No bot")
        cost = _optional_cost(s.get("_cost"))
        tin = _usage_num(s.get("_in"))
        tout = _usage_num(s.get("_out"))
        updated = s.get("_updatedMs")
        prev = seen.get(name)
        if not started or prev is None:
            if isinstance(updated, (int, float)) and not isinstance(updated, bool) and updated > 0:
                day = _zone_day_ms(int(updated), zone)
                at_ms = int(updated)
            else:
                day = today
                at_ms = now_ms
            if day in allowed:
                add(day, at_ms, bot, model, cost, tin, tout)
        else:
            add(
                today,
                now_ms,
                bot,
                model,
                _cost_delta(cost, prev.get("cost")),
                max(0.0, tin - prev["in"]),
                max(0.0, tout - prev["out"]),
            )
        seen[name] = {"cost": cost, "in": tin, "out": tout}

    ensure(today, now_ms)
    days = {day: bucket for day, bucket in days.items() if day in allowed}
    points = []
    for day in sorted(days):
        bucket = days[day]
        points.append({
            "at": bucket["at"],
            "totalCost": round(float(bucket["totalCost"]), 4),
            "tokensIn": int(bucket["tokensIn"]),
            "tokensOut": int(bucket["tokensOut"]),
            "providers": sorted(
                bucket["providers"],
                key=lambda row: (str(row.get("bot") or ""), str(row.get("model") or "")),
            ),
        })
    return {"points": points}, {"started": True, "seen": seen, "days": days}


# ── Memory (OpenClaw workspace files to memory.snapshot) ────────────────────
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
# A line by itself, so a sentence that happens to mention a clock is not a timestamp.
NOTE_CLOCK = re.compile(
    r"^(?:#+\s*)?(?:time\s*:\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)?(?:\s+\S+)?\s*$",
    re.IGNORECASE,
)
MAX_MEMORY_BYTES = 1_000_000


def memory_stable_id(agent_id: str, rel: str) -> str:
    """Stable across re-syncs. Same agent and relative path give the same id."""
    digest = hashlib.sha256(f"{agent_id}\n{rel}".encode("utf-8")).hexdigest()[:24]
    return f"mem-{digest}"


def iso_utc(mtime: float) -> str:
    dt = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_z(dt: datetime.datetime) -> str:
    utc = dt.astimezone(datetime.timezone.utc).replace(microsecond=0)
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ")


# Same list as the API and the web app: config/timezones.json.
# Legacy names convert to the current name. Offsets and abbreviations stay refused.
_TIMEZONES: Optional[Dict[str, Any]] = None


def timezones_file() -> Path:
    """Shared zone list. Next to this script in the repo, or MC_TIMEZONES_FILE."""
    override = os.environ.get("MC_TIMEZONES_FILE", "").strip()
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "config" / "timezones.json"
        if candidate.is_file():
            return candidate
    return here.parent.parent / "config" / "timezones.json"


def load_timezones() -> Dict[str, Any]:
    global _TIMEZONES
    if _TIMEZONES is not None:
        return _TIMEZONES
    raw = json.loads(timezones_file().read_text(encoding="utf-8"))
    zones = set(raw.get("zones") or [])
    legacy = {
        str(src): str(dst)
        for src, dst in (raw.get("legacy") or {}).items()
        if str(dst) in zones
    }
    _TIMEZONES = {"zones": zones, "legacy": legacy}
    return _TIMEZONES


def canonical_zone(name: str) -> Optional[str]:
    """Current name from the shared list, or None."""
    text = (name or "").strip()
    if not text or len(text) > 80:
        return None
    table = load_timezones()
    mapped = table["legacy"].get(text, text)
    if mapped in table["zones"]:
        return mapped
    return None


def zone_name_allowed(name: str) -> bool:
    """True when the name is in the shared list, after a legacy conversion."""
    return canonical_zone(name) is not None


def iana_zone(name: str) -> Optional[datetime.tzinfo]:
    """Current IANA zone. None when the name is blank or not in the shared list."""
    text = canonical_zone(name)
    if not text:
        return None
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        return datetime.timezone.utc if text == "UTC" else None
    try:
        return ZoneInfo(text)
    except Exception:
        return datetime.timezone.utc if text == "UTC" else None


def host_zone_name(path: str = "/etc/localtime") -> Optional[str]:
    """Zone named by the /etc/localtime symlink, converted to a current name."""
    try:
        target = os.readlink(path)
    except OSError:
        return None
    text = target.replace("\\", "/")
    marker = "zoneinfo/"
    idx = text.rfind(marker)
    named = text[idx + len(marker):] if idx != -1 else text
    return canonical_zone(named.strip("/"))


def resolve_tz(name: Optional[str] = None) -> datetime.tzinfo:
    """
    Timezone for daily notes and usage days.

    A name from GET /settings wins. Then MC_TIMEZONE, then TZ, then the
    host zone from the /etc/localtime symlink. Legacy names convert first.
    """
    if name:
        found = iana_zone(name)
        if found is not None:
            return found
    for key in ("MC_TIMEZONE", "TZ"):
        found = iana_zone(os.environ.get(key, ""))
        if found is not None:
            return found
    host = host_zone_name()
    if host:
        found = iana_zone(host)
        if found is not None:
            return found
    return datetime.timezone.utc


def fetch_api_timezone(api_url: str) -> Optional[str]:
    """GET /settings timezone. None when the API is down or the field is missing."""
    req = urllib.request.Request(f"{api_url.rstrip('/')}/settings", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(body, dict):
        return None
    zone = body.get("timezone")
    if isinstance(zone, str) and zone.strip():
        return zone.strip()
    return None


def zone_day_of(dt: datetime.datetime, tz: datetime.tzinfo) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(tz).strftime("%Y-%m-%d")


def zone_wall(day: str, hour: int, minute: int, tz: datetime.tzinfo) -> datetime.datetime:
    """UTC instant of a clock time on a calendar day in `tz`."""
    year, month, date = (int(part) for part in day.split("-"))
    local = datetime.datetime(year, month, date, hour, minute, tzinfo=tz)
    return local.astimezone(datetime.timezone.utc)


def parse_note_clock(body: str) -> Optional[tuple]:
    """First standalone clock in the note, or None. 23:58 and 11:58 PM both work."""
    for line in body.splitlines()[:30]:
        match = NOTE_CLOCK.match(line.strip())
        if not match:
            continue
        hour = int(match.group(1))
        minute = int(match.group(2))
        ampm = (match.group(3) or "").upper()
        if minute > 59:
            continue
        if ampm:
            if hour < 1 or hour > 12:
                continue
            hour = (0 if hour == 12 else hour) if ampm == "AM" else (12 if hour == 12 else hour + 12)
        elif hour > 23:
            continue
        return hour, minute
    return None


def daily_created_at(day: str, mtime: float, body: str, tz: Optional[datetime.tzinfo] = None) -> str:
    """
    Daily notes take their calendar day from the filename, in `tz`.

    A copy, restore, or checkout rewrites mtime, and appending after midnight
    must not move yesterday's note onto today. Use mtime only when that
    instant already falls on the filename date in `tz`. Otherwise a
    standalone clock in the note (``Time: 23:58``), and if there is none,
    12:00 on that date in `tz`.
    """
    zone = tz if tz is not None else resolve_tz()
    mtime_dt = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc)
    if zone_day_of(mtime_dt, zone) == day:
        return iso_utc(mtime)
    clock = parse_note_clock(body)
    if clock:
        return iso_z(zone_wall(day, clock[0], clock[1], zone))
    return iso_z(zone_wall(day, 12, 0, zone))


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
    does not exist. The caller skips the snapshot instead of posting [].
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
        log(f"{path}: {exc}. Skipping")
        return None
    if size > MAX_MEMORY_BYTES:
        log(f"{path}: over 1MB. Skipping")
        return None
    # Read in chunks and stop past the cap, so a file that grew after the
    # stat cannot load more than 1MB. Newlines match text mode reads.
    chunks: List[bytes] = []
    total = 0
    try:
        with path.open("rb") as handle:
            while total <= MAX_MEMORY_BYTES:
                chunk = handle.read(65536)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
    except OSError as exc:
        log(f"{path}: {exc}. Skipping")
        return None
    if total > MAX_MEMORY_BYTES:
        log(f"{path}: over 1MB. Skipping")
        return None
    text = b"".join(chunks).decode("utf-8", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


class MemoryMemo:
    """Memory entries from the last run, keyed by file path (#118).

    A file whose mtime, size, agent, kind, day, and timezone match the
    stored row is not read again. Every other file is read and stored.
    """

    def __init__(self, stored: Any = None) -> None:
        self.old: Dict[str, Any] = stored if isinstance(stored, dict) else {}
        self.new: Dict[str, Any] = {}
        self.reads = 0
        self.reused = 0


def _zone_key(tz: Optional[datetime.tzinfo]) -> str:
    if tz is None:
        return ""
    return str(getattr(tz, "key", None) or tz)


def entry_from_file(
    agent_id: str,
    agent_name: str,
    workspace: Path,
    path: Path,
    kind: str,
    day: Optional[str] = None,
    tz: Optional[datetime.tzinfo] = None,
    memo: Optional[MemoryMemo] = None,
) -> Optional[Dict[str, Any]]:
    if memo is None:
        return _entry_from_file(agent_id, agent_name, workspace, path, kind, day, tz)
    try:
        st = path.stat()
    except OSError as exc:
        log(f"{path}: {exc}. Skipping")
        return None
    key = str(path)
    sig = [st.st_mtime_ns, st.st_size, agent_id, agent_name, str(workspace), kind, day, _zone_key(tz)]
    hit = memo.old.get(key)
    if isinstance(hit, dict) and hit.get("sig") == sig and isinstance(hit.get("entry"), dict):
        memo.new[key] = hit
        memo.reused += 1
        return dict(hit["entry"])
    memo.reads += 1
    row = _entry_from_file(agent_id, agent_name, workspace, path, kind, day, tz)
    if row is not None:
        memo.new[key] = {"sig": sig, "entry": row}
    return row


def _entry_from_file(
    agent_id: str,
    agent_name: str,
    workspace: Path,
    path: Path,
    kind: str,
    day: Optional[str] = None,
    tz: Optional[datetime.tzinfo] = None,
) -> Optional[Dict[str, Any]]:
    text = _read_memory_text(path)
    if text is None:
        return None
    body = text.strip()
    if not body:
        return None
    rel = path.relative_to(workspace).as_posix()
    try:
        mtime = path.stat().st_mtime
    except OSError as exc:
        log(f"{path}: {exc}. Skipping it.")
        return None
    # `day` is the filename date for a daily note. Long-term MEMORY.md has
    # no date in the name and keeps the file mtime.
    created = daily_created_at(day, mtime, body, tz) if day else iso_utc(mtime)
    return {
        "id": memory_stable_id(agent_id, rel),
        "title": memory_title(body, path.stem),
        "body": body,
        "agent": agent_name,
        "createdAt": created,
        "kind": kind,
        "source": "bridge",
        "ref": rel,
    }


def collect_memory(
    agents: List[Dict[str, Any]],
    base: Optional[Path] = None,
    tz: Optional[datetime.tzinfo] = None,
    memo: Optional[MemoryMemo] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Read each agent's MEMORY.md and memory/YYYY-MM-DD*.md.

    Returns None when there is nothing to post: no agents, or agents were
    given but no workspace directory could be read. An empty list is a
    readable workspace with zero notes. The API treats that empty entries
    list as a no-op, so it cannot delete every agent's rows. Returns []
    only when a workspace was readable and simply had no notes.
    """
    if not agents:
        return None
    readable = 0
    by_id: Dict[str, Dict[str, Any]] = {}
    for agent in agents:
        raw = agent.get("workspace")
        if not isinstance(raw, str) or not raw.strip():
            continue
        workspace = resolve_workspace(raw, base)
        if not workspace.is_dir():
            log(f"memory workspace missing: {workspace}. Skipping that agent.")
            continue
        readable += 1
        agent_id = str(first(agent, "id", "name") or workspace.name)
        agent_name = str(first(agent, "identityName", "name", "id") or agent_id)
        long_term = workspace / "MEMORY.md"
        if long_term.is_file():
            row = entry_from_file(agent_id, agent_name, workspace, long_term, "long-term", tz=tz, memo=memo)
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
            row = entry_from_file(agent_id, agent_name, workspace, path, "daily", match.group(1), tz, memo)
            if row:
                by_id[row["id"]] = row
    if readable == 0:
        return None
    return sorted(by_id.values(), key=lambda row: (row["createdAt"], row["id"]), reverse=True)


# ── Transport ───────────────────────────────────────────────────────────────

def _read_json(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def _error_message(body: Any) -> str:
    if not isinstance(body, dict):
        return ""
    message = body.get("message")
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        return " ".join(str(part) for part in message)
    return ""


def write_json(
    api_url: str,
    token: str,
    method: str,
    path: str,
    body: Dict[str, Any],
) -> Tuple[bool, int, Any]:
    """One JSON write. Sends x-ingest-token. Never logs the token.

    2xx is success unless the body still carries a string `error` key
    (the old runs shape). 400 and 404 come back as (False, status, body).
    """
    url = f"{api_url.rstrip('/')}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-ingest-token": token},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            parsed = _read_json(r.read())
            status = r.status
            if isinstance(parsed, dict) and isinstance(parsed.get("error"), str):
                log(f"{method} {path}: HTTP {status} returned an error key")
                return False, status, parsed
            return True, status, parsed
    except urllib.error.HTTPError as e:
        parsed = _read_json(e.read())
        hint = " (INGEST_TOKEN mismatch with the api?)" if e.code == 401 else ""
        detail = _error_message(parsed)
        suffix = f" {detail}" if detail else ""
        log(f"{method} {path}: HTTP {e.code}{hint}{suffix}")
        return False, e.code, parsed
    except urllib.error.URLError as e:
        log(f"{method} {path}: api unreachable at {api_url} ({e.reason})")
        return False, 0, None


def _accepted(ok: bool, status: int, expected: int) -> bool:
    return bool(ok) and status == expected


def _unknown_ticket(status: int, body: Any) -> bool:
    """True when the API rejected the call because ticketId is not a ticket."""
    return status == 404 and "ticketId" in _error_message(body)


def _without_ticket(body: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in body.items() if key != "ticketId"}


def write_run(
    api_url: str,
    token: str,
    method: str,
    path: str,
    body: Dict[str, Any],
) -> Tuple[bool, int, Any]:
    """POST or PATCH one run. A 404 for an unknown ticketId is retried once.

    The retry drops ticketId and logs a warning. The run is still recorded,
    so a job is not dropped and is not left stuck in running. Any other
    status is returned as-is. The token is never logged.
    """
    payload = body if isinstance(body, dict) else {}
    ok, status, parsed = write_json(api_url, token, method, path, payload)
    if ok or "ticketId" not in payload or not _unknown_ticket(status, parsed):
        return ok, status, parsed
    log(
        f"warning: {method} {path} unknown ticketId {payload.get('ticketId')}. "
        "Retrying once without ticketId"
    )
    return write_json(api_url, token, method, path, _without_ticket(payload))


def apply_run_calls(
    api_url: str,
    token: str,
    calls: List[Dict[str, Any]],
    state: Dict[str, Any],
    failed_jobs: Optional[Set[str]] = None,
) -> int:
    """POST /runs (expect 201) and PATCH /runs/:id (expect 200).

    Returns how many calls failed. A 201 whose body has an error key is a
    failure. A 404 for an unknown ticketId is retried once without ticketId
    and does not count as a failure when that retry succeeds. On create, the
    new id is stored on the job so the next sync can PATCH it. Job ids that
    failed are added to `failed_jobs` when that set is passed. The token is
    never logged.
    """
    failures = 0

    def fail(job_id: str) -> None:
        nonlocal failures
        failures += 1
        if failed_jobs is not None and job_id:
            failed_jobs.add(job_id)

    for call in calls:
        job_id = str(call.get("jobId") or "")
        if call.get("op") == "patch":
            path = "/runs/" + urllib.parse.quote(str(call.get("runId") or ""), safe="")
            ok, status, body = write_run(api_url, token, "PATCH", path, call.get("body") or {})
            if _accepted(ok, status, 200):
                continue
            log(f"PATCH {path}: expected HTTP 200, got {status} {_error_message(body)}".rstrip())
            fail(job_id)
            continue
        ok, status, body = write_run(api_url, token, "POST", "/runs", call.get("body") or {})
        if not _accepted(ok, status, 201) or not isinstance(body, dict):
            log(f"POST /runs: expected HTTP 201, got {status} {_error_message(body)}".rstrip())
            fail(job_id)
            continue
        run = body.get("run")
        run_id = run.get("id") if isinstance(run, dict) else None
        if not isinstance(run_id, str) or not run_id:
            log("POST /runs: HTTP 201 had no run id")
            fail(job_id)
            continue
        slot = state.get(job_id)
        if isinstance(slot, dict):
            slot["runId"] = run_id
        follow = call.get("follow")
        if not isinstance(follow, dict):
            continue
        path = "/runs/" + urllib.parse.quote(run_id, safe="")
        ok2, status2, body2 = write_run(api_url, token, "PATCH", path, follow)
        if _accepted(ok2, status2, 200):
            continue
        log(f"PATCH {path}: expected HTTP 200, got {status2} {_error_message(body2)}".rstrip())
        fail(job_id)
    return failures


def keep_successful_run_state(
    prior: Dict[str, Any],
    state: Dict[str, Any],
    failed_jobs: Set[str],
) -> None:
    """Leave successful jobs as planned. Roll a failed job back.

    A create that landed keeps its new runId, so the next sync patches that
    row instead of inserting another one. A failure that stored nothing
    restores the previous slot, and the same transition is tried again.
    """
    for jid in failed_jobs:
        current = state.get(jid) if isinstance(state.get(jid), dict) else None
        prev = prior.get(jid) if isinstance(prior.get(jid), dict) else None
        prev_run = prev.get("runId") if prev else None
        current_run = current.get("runId") if isinstance(current, dict) else None
        if current_run and current_run != prev_run:
            continue
        if prev is None:
            state.pop(jid, None)
        else:
            state[jid] = dict(prev)


def persist_run_state(state_file: Path, state: Dict[str, Any], event_failures: int) -> None:
    """Write the run-diff file unless an activity post failed.

    A failed POST /runs or PATCH /runs does not skip this. Those jobs were
    already rolled back. The runs that succeeded stay in the file.
    """
    if event_failures != 0:
        return
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state))


def post_register(api_url: str, token: str, body: Dict[str, Any]) -> bool:
    """POST /agents/register. True on 200 or 201. Logs the status, never the token."""
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/agents/register",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-ingest-token": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status in (200, 201)
    except urllib.error.HTTPError as e:
        hint = " (INGEST_TOKEN mismatch with the api?)" if e.code == 401 else ""
        log(f"POST /agents/register: HTTP {e.code}{hint}")
    except urllib.error.URLError as e:
        log(f"POST /agents/register: api unreachable at {api_url} ({e.reason})")
    return False


def post(api_url: str, token: str, etype: str, payload: Dict[str, Any]) -> bool:
    """POST one event. True on 2xx. Logs the status, never the token.

    The API applies the same x-ingest-token check to every write route.
    POST /events, POST /runs, and PATCH /runs/:id all send that header.
    """
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


def stamp_path() -> Path:
    """Unix timestamp file doctor reads. Override with MC_BRIDGE_STAMP_FILE."""
    raw = os.environ.get("MC_BRIDGE_STAMP_FILE", "").strip()
    if raw:
        return Path(raw)
    return BRIDGE_DIR / ".state" / "last-sync"


def record_sync() -> None:
    """Record a successful sync. A dry run does not call this."""
    path = stamp_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{int(time.time())}\n", encoding="utf-8")
    except OSError as exc:
        log(f"could not record the sync time ({exc})")


# ── Slow changing data cache (#118) ────────────────────────────────────────

CACHE_VERSION = 1
DEFAULT_REFRESH_SECONDS = 3600


def refresh_seconds() -> int:
    """MC_BRIDGE_REFRESH_SECONDS, default 3600. Invalid uses the default."""
    raw = os.environ.get("MC_BRIDGE_REFRESH_SECONDS", "").strip()
    if raw.isdigit():
        return int(raw)
    return DEFAULT_REFRESH_SECONDS


def cache_path_for(state_file: Path) -> Path:
    """MC_BRIDGE_CACHE_FILE, or cli-cache.json next to the state file."""
    raw = os.environ.get("MC_BRIDGE_CACHE_FILE", "").strip()
    if raw:
        return Path(raw)
    return state_file.with_name("cli-cache.json")


def config_signature(path: Optional[Path]) -> Optional[List[int]]:
    """mtime and size of openclaw.json, or None when there is no file."""
    if path is None:
        return None
    try:
        st = path.stat()
    except OSError:
        return None
    return [st.st_mtime_ns, st.st_size]


class SlowData:
    """Agents, cron, devices, nodes, the models list, and the CLI version.

    These change slowly, so a steady state run reuses the values stored by
    an earlier run instead of starting `openclaw` again. All of them are
    fetched again when openclaw.json changes, when the stored values are
    older than refresh_seconds(), or when this run's sessions call failed.
    A value that is missing, because it was never stored or its call
    failed, is fetched on the next run. A failed call is never stored, so
    a skipped snapshot is not replayed. --from-dir never caches CLI data.
    Memory rows share the file and are keyed by file mtime.
    """

    def __init__(self, path: Path, now_s: int, config_sig: Optional[List[int]], use_cli_cache: bool) -> None:
        self.path = path
        self.now_s = now_s
        self.config_sig = config_sig
        self.use_cli_cache = use_cli_cache
        stored: Dict[str, Any] = {}
        try:
            loaded = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
            if isinstance(loaded, dict) and loaded.get("version") == CACHE_VERSION:
                stored = loaded
        except (OSError, ValueError):
            stored = {}
        self.memory = MemoryMemo(stored.get("memory"))
        values = stored.get("values")
        fetched_at = stored.get("fetchedAt")
        fresh = (
            use_cli_cache
            and isinstance(values, dict)
            and isinstance(fetched_at, int)
            and stored.get("config") == config_sig
            and 0 <= now_s - fetched_at < refresh_seconds()
        )
        self.values: Dict[str, Any] = dict(values) if fresh else {}
        self.fetched_at: int = fetched_at if fresh else now_s
        self.refreshed = not fresh
        self.from_cache: List[str] = []

    def full_refresh(self) -> None:
        """Drop the stored values. Later getters call the CLI again."""
        self.values = {}
        self.fetched_at = self.now_s
        self.refreshed = True

    def get(self, key: str, fetch: Callable[[], Any]) -> Any:
        if self.use_cli_cache and key in self.values:
            self.from_cache.append(key)
            return self.values[key]
        value = fetch()
        if self.use_cli_cache and value is not None:
            self.values[key] = value
        return value

    def save(self) -> None:
        if not self.values and not self.memory.new and not self.path.exists():
            return
        body = {
            "version": CACHE_VERSION,
            "config": self.config_sig,
            "fetchedAt": self.fetched_at,
            "values": self.values if self.use_cli_cache else {},
            "memory": self.memory.new,
        }
        tmp = self.path.with_name(self.path.name + ".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(body), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            log(f"could not save the bridge cache ({exc})")


def _rss_mb(raw: int) -> float:
    """ru_maxrss is kilobytes on Linux and bytes on macOS."""
    return raw / (1024 * 1024) if sys.platform == "darwin" else raw / 1024


def profile_lines(started: float, slow: Optional["SlowData"]) -> List[str]:
    """--profile output: wall time, CPU and peak memory with every child."""
    import resource

    me = resource.getrusage(resource.RUSAGE_SELF)
    kids = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu_self = me.ru_utime + me.ru_stime
    cpu_kids = kids.ru_utime + kids.ru_stime
    mem_self = _rss_mb(me.ru_maxrss)
    mem_kids = _rss_mb(kids.ru_maxrss)
    calls = sum(OPENCLAW_CALLS.values())
    lines = [
        f"profile: wall {time.monotonic() - started:.2f} s",
        f"profile: CPU {cpu_self + cpu_kids:.2f} s (bridge {cpu_self:.2f} s, child processes {cpu_kids:.2f} s)",
        f"profile: peak memory {mem_self + mem_kids:.1f} MB (bridge {mem_self:.1f} MB, largest child process {mem_kids:.1f} MB)",
        f"profile: openclaw calls {calls}",
    ]
    for key in sorted(OPENCLAW_CALLS):
        lines.append(f"profile: openclaw {key}: {OPENCLAW_CALLS[key]}")
    if slow is not None and slow.use_cli_cache:
        state = "refreshed this run" if slow.refreshed else "read from the cache"
        lines.append(f"profile: slow changing data {state}")
    if slow is not None:
        lines.append(f"profile: memory files read {slow.memory.reads}, reused {slow.memory.reused}")
    return lines


# ── Main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="OpenClaw to Mission Control bridge, one sync per run")
    ap.add_argument("--dry-run", action="store_true", help="print events as JSON lines; post nothing")
    ap.add_argument("--from-dir", type=Path, help="read <dir>/{agents,sessions,cron,approvals,devices,nodes}.json instead of the CLI")
    ap.add_argument(
        "--memory-dir",
        type=Path,
        help="read an OpenClaw memory tree (one workspace, or one subdirectory per agent)",
    )
    ap.add_argument(
        "--profile",
        action="store_true",
        help="print wall time, CPU and peak memory with child processes, and openclaw calls by command",
    )
    args = ap.parse_args()
    started = time.monotonic()
    holder: Dict[str, Any] = {}
    try:
        return run_sync(args, holder)
    finally:
        if args.profile:
            for line in profile_lines(started, holder.get("slow")):
                log(line)


def run_sync(args: argparse.Namespace, holder: Dict[str, Any]) -> int:

    # Repo-root .env is the single source of truth for INGEST_TOKEN (same file
    # docker compose reads). Real env vars override it.
    load_dotenv(REPO_ROOT / ".env")
    api_url = default_api_url()
    token = os.environ.get("INGEST_TOKEN", "")
    if not token and not args.dry_run:
        # Compose falls back to `dev-ingest-token` when .env leaves it blank;
        # we deliberately do NOT guess. An explicit token avoids silent 401s.
        log("INGEST_TOKEN is not set in the environment or the repo root .env. Refusing to post.")
        return 2

    src = Sources(args.from_dir)
    now_ms = int(time.time() * 1000)
    # Dry run stays on env so a missing API does not add a timeout.
    # A real sync reads the timezone the API is bucketing with.
    api_zone = None if args.dry_run else fetch_api_timezone(api_url)
    zone = resolve_tz(api_zone)
    events: List[Tuple[str, Dict[str, Any]]] = []

    state_file = Path(os.environ.get("MC_BRIDGE_STATE_FILE", DEFAULT_STATE_FILE))
    slow = SlowData(
        cache_path_for(state_file),
        now_ms // 1000,
        config_signature(config_path_for(args.from_dir)),
        use_cli_cache=args.from_dir is None,
    )
    holder["slow"] = slow

    raw_sessions = src.sessions()
    if raw_sessions is None:
        # A failed sessions call means the CLI may be gone. Do not replay
        # stored values. Ask every source again, as a first run would.
        slow.full_refresh()
    sessions_rows = as_list(raw_sessions, "sessions")
    sessions = map_sessions(sessions_rows, now_ms) if sessions_rows is not None else None

    agents_rows = as_list(slow.get("agents", src.agents), "agents")
    register_bodies: List[Dict[str, Any]] = []
    if agents_rows is not None:
        mapped_agents = map_agents(agents_rows, sessions or [])
        events.append(("agents.snapshot", {"agents": mapped_agents}))
        if wants_self_register():
            register_bodies = register_payloads(mapped_agents)
    if sessions is not None:
        events.append(("sessions.snapshot", {"sessions": strip_private(sessions)}))

    cron_rows = as_list(slow.get("cron", src.cron), "jobs", "cron")
    state: Dict[str, Any] = {}
    prior_state: Dict[str, Any] = {}
    run_calls: List[Dict[str, Any]] = []
    try:
        loaded = json.loads(state_file.read_text()) if state_file.is_file() else {}
        state = loaded if isinstance(loaded, dict) else {}
    except (OSError, json.JSONDecodeError):
        state = {}
    if cron_rows is not None:
        events.append(("calendar.snapshot", {"jobs": map_cron(cron_rows)}))
        prior_state = {k: dict(v) for k, v in state.items() if isinstance(v, dict)}
        run_events, run_calls = cron_run_plan(cron_rows, state)
        events.extend(run_events)

    if sessions is not None:
        local_names = {"ollama"}
        cfg_path = config_path_for(args.from_dir)
        if cfg_path is not None and cfg_path.is_file():
            usage_cfg = read_openclaw_config(cfg_path)
            if isinstance(usage_cfg, dict):
                local_names = local_provider_names(usage_cfg)
        usage_payload, usage_state = usage_points_from_sessions(
            sessions, now_ms, state.get("_mcUsage"), local_names, zone
        )
        state["_mcUsage"] = usage_state
        if usage_payload["points"]:
            events.append(("usage.snapshot", usage_payload))

    device_rows = map_openclaw_devices(slow.get("devices", src.devices))
    node_rows = map_openclaw_nodes(slow.get("nodes", src.nodes))
    machines: Dict[str, Any] = {}
    if device_rows is not None:
        machines["devices"] = device_rows
    if node_rows is not None:
        machines["nodes"] = node_rows
    if machines:
        events.append(("devices.snapshot", machines))

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
            log(f"memory dir {args.memory_dir} not found. Skipping memory.snapshot.")
        elif len(mem_agents) == 0:
            log(f"memory dir {args.memory_dir} has no agent workspaces. Skipping memory.snapshot.")
        else:
            memory_entries = collect_memory(mem_agents, tz=zone, memo=slow.memory)
    elif agents_rows is not None:
        memory_entries = collect_memory(agents_rows, base=args.from_dir, tz=zone, memo=slow.memory)
    if memory_entries is not None:
        events.append(("memory.snapshot", {"entries": memory_entries}))

    def cli_version() -> Optional[str]:
        return slow.get("version", openclaw_cli_version)

    models_payload = collect_models(
        src,
        args.from_dir,
        catalog_of=lambda: slow.get("models", src.model_catalog),
        version_of=cli_version,
    )
    if models_payload is not None:
        events.append(("models.snapshot", models_payload))

    # The gateway check always posts, including when OpenClaw itself is missing.
    # It is not an OpenClaw snapshot, so it does not refresh the sync stamp
    # and a rejected check does not fail the sync. The next run tries again.
    openclaw_events = len(events)
    gateway_payload = probe_gateway(cli_version)
    if openclaw_events == 0:
        log("no OpenClaw sources available. Posting the gateway check only")

    if args.dry_run:
        for etype, payload in events:
            print(json.dumps({"type": etype, "payload": payload}))
        print(json.dumps({"type": "gateway.snapshot", "payload": gateway_payload}))
        for body in register_bodies:
            print(json.dumps({"call": "POST /agents/register", "body": body}))
        return 0  # dry-run never writes the state file or the cache either

    slow.save()

    event_failures = sum(0 if post(api_url, token, t, p) else 1 for t, p in events)
    gateway_ok = post(api_url, token, "gateway.snapshot", gateway_payload)
    if not gateway_ok:
        log("gateway.snapshot was not accepted. The next run will try again.")
    # Optional. Off unless MC_BRIDGE_REGISTER is 1, true, or yes. A failed
    # register does not undo the snapshot that already landed.
    register_failures = sum(0 if post_register(api_url, token, body) else 1 for body in register_bodies)
    # Run rows are separate from the activity events. 201 create, 200 update.
    # A 404 for an unknown ticketId is retried once without ticketId inside
    # apply_run_calls, so that case is not a failure. Any other failed run
    # is rolled back to its previous slot. The runs that succeeded are still
    # written, so one bad job cannot duplicate a healthy one or leave it
    # running. The token stays in the header only. A failed activity post
    # still skips the file so that run.* event is retried next sync.
    run_failures = 0
    if run_calls:
        failed_jobs: Set[str] = set()
        run_failures = apply_run_calls(api_url, token, run_calls, state, failed_jobs)
        keep_successful_run_state(prior_state, state, failed_jobs)
    failures = event_failures + run_failures + register_failures
    # Usage deltas share this file. A failed activity post skips the write so
    # a delta is not counted twice. A failed run does not: that job was rolled
    # back, and the runs that succeeded stay saved.
    if event_failures == 0 and (cron_rows is not None or sessions is not None):
        persist_run_state(state_file, state, 0)
    posted = len(events) + len(register_bodies) - failures + (1 if gateway_ok else 0)
    total = len(events) + len(register_bodies) + 1
    log(f"posted {posted}/{total} events to {api_url}/events")
    if event_failures == 0 and openclaw_events > 0:
        record_sync()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
