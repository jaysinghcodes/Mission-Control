"""Synthetic OpenClaw install for the light bridge tests (#118).

10 agents, 5,000 sessions and 500 memory files, plus a stub `openclaw`
that prints recorded JSON and logs every call. The clock is frozen per
run, so two bridges given the same stub outputs can be compared byte for
byte. Nothing here touches the network beyond a local capture server.
"""
from __future__ import annotations

import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
BRIDGE = HERE / "mc-bridge-sync.py"
EXAMPLES = HERE / "examples"

AGENTS = 10
SESSIONS = 5000
MEMORY_FILES = 500
# Fri Oct 16 2026 17:00:00 UTC. Every run is pinned to this clock plus an offset.
BASE_S = 1792170000

STUB = r'''#!/usr/bin/env python3
import os, sys
root = os.environ["MC_STUB_DIR"]
args = " ".join(sys.argv[1:])
failing = [item for item in os.environ.get("MC_STUB_FAIL", "").split(",") if item]
with open(os.path.join(root, "calls.log"), "a", encoding="utf-8") as fh:
    fh.write(args + "\n")
files = {
    "sessions --all-agents --json": "sessions.json",
    "agents list --json": "agents.json",
    "cron list --all --json": "cron.json",
    "devices list --json": "devices.json",
    "nodes list --json": "nodes.json",
    "nodes status --json": "nodes-status.json",
    "models list --json": "models.json",
    "models list": "models.txt",
    "--version": "version.txt",
}
if args in failing:
    sys.stderr.write("stub failure\n")
    sys.exit(1)
name = files.get(args)
if name is None:
    sys.stderr.write("unknown command\n")
    sys.exit(2)
with open(os.path.join(root, name), encoding="utf-8") as fh:
    sys.stdout.write(fh.read())
'''

PROVIDERS = [
    ("deepseek", "deepseek/deepseek-v4-flash"),
    ("openai", "openai/gpt-4.1"),
    ("anthropic", "anthropic/claude-sonnet-4-5"),
    ("ollama", "ollama/llama3.1"),
]


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=1), encoding="utf-8")


def build(root: Path) -> Dict[str, Path]:
    """Write the fixture under root. Returns the paths a run needs."""
    stub = root / "stub"
    bin_dir = root / "bin"
    home = root / "home"
    spaces = root / "workspaces"
    for d in (stub, bin_dir, home, spaces):
        d.mkdir(parents=True, exist_ok=True)
    (bin_dir / "openclaw").write_text(STUB, encoding="utf-8")
    (bin_dir / "openclaw").chmod(0o755)

    agents = []
    per_agent = MEMORY_FILES // AGENTS
    for i in range(AGENTS):
        aid = f"agent{i:02d}"
        ws = spaces / aid
        (ws / "memory").mkdir(parents=True, exist_ok=True)
        agents.append({"id": aid, "identityName": f"Agent {i:02d}", "identityEmoji": "🤖", "workspace": str(ws), **({"isDefault": True} if i == 0 else {})})
        long_term = ws / "MEMORY.md"
        long_term.write_text(f"# Agent {i:02d} long term\n\n" + ("Keeps the build notes short. " * 20) + "\n", encoding="utf-8")
        os.utime(long_term, (BASE_S - 86400 * 40, BASE_S - 86400 * 40))
        for n in range(per_agent - 1):
            day = f"2026-{9 + (n // 30):02d}-{1 + (n % 30):02d}"
            note = ws / "memory" / f"{day}.md"
            note.write_text(f"# {day} notes for {aid}\n\n" + (f"Item {n} shipped and was checked. " * 15) + "\n", encoding="utf-8")
            os.utime(note, (BASE_S - 86400 * (60 - n), BASE_S - 86400 * (60 - n)))
    _write_json(stub / "agents.json", agents)

    rows = []
    for n in range(SESSIONS):
        provider, model = PROVIDERS[n % len(PROVIDERS)]
        aid = f"agent{n % AGENTS:02d}"
        rows.append({
            "agentId": aid,
            "key": f"agent:{aid}:s{n:05d}",
            "sessionId": f"s{n:05d}",
            "kind": "direct",
            "model": model.split("/", 1)[1],
            "modelProvider": provider,
            "updatedAt": (BASE_S - n * 97) * 1000,
            "inputTokens": 1000 + (n * 37) % 9000,
            "outputTokens": 200 + (n * 13) % 2000,
            "totalTokens": 1200 + (n * 50) % 11000,
            "contextTokens": 200000,
        })
    _write_json(stub / "sessions.json", {"path": None, "count": len(rows), "allAgents": True, "sessions": rows})

    jobs = []
    for n in range(6):
        jobs.append({
            "id": f"job-{n}", "name": f"Job {n}", "agentId": f"agent{n:02d}", "enabled": True,
            "status": "ok" if n % 2 == 0 else "idle",
            "schedule": {"kind": "cron", "expr": f"{n * 5} 7 * * *"},
            **({"state": {"lastRunAtMs": (BASE_S - 3600 * n) * 1000, "lastRunStatus": "ok", "lastDurationMs": 1200}} if n % 2 == 0 else {}),
        })
    _write_json(stub / "cron.json", {"jobs": jobs})

    shutil.copy(EXAMPLES / "devices" / "devices.json", stub / "devices.json")
    nodes = json.loads((EXAMPLES / "devices" / "nodes.json").read_text(encoding="utf-8"))
    _write_json(stub / "nodes.json", nodes)
    _write_json(stub / "nodes-status.json", nodes)
    _write_json(stub / "models.json", {"models": [{"key": m} for _, m in PROVIDERS]})
    (stub / "models.txt").write_text("\n".join(m for _, m in PROVIDERS) + "\n", encoding="utf-8")
    (stub / "version.txt").write_text("OpenClaw 2026.7.1-2\n", encoding="utf-8")

    config = root / "openclaw.json"
    _write_json(config, {"models": {"providers": {"ollama": {"baseUrl": "http://127.0.0.1:11434", "api": "ollama"}}}})
    return {"root": root, "bin": bin_dir, "stub": stub, "home": home, "config": config}


class _Capture(http.server.BaseHTTPRequestHandler):
    log: List[Tuple[str, str, bytes]] = []

    def log_message(self, *args: Any) -> None:  # quiet
        pass

    def _reply(self, status: int, body: Any) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path.startswith("/settings"):
            self._reply(200, {"timezone": "America/Chicago"})
        else:
            self._reply(404, {"message": "not found"})

    def _body(self) -> bytes:
        size = int(self.headers.get("content-length") or 0)
        return self.rfile.read(size)

    def do_POST(self) -> None:
        body = self._body()
        type(self).log.append(("POST", self.path, body))
        if self.path == "/runs":
            self._reply(201, {"id": f"run-{len(type(self).log)}"})
        else:
            self._reply(200, {"ok": True})

    def do_PATCH(self) -> None:
        body = self._body()
        type(self).log.append(("PATCH", self.path, body))
        self._reply(200, {"ok": True})


def run(
    paths: Dict[str, Path],
    offset_s: int,
    state_dir: Path,
    bridge: Path = BRIDGE,
    extra_args: Optional[List[str]] = None,
    extra_env: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """One bridge run with the clock pinned to BASE_S + offset_s."""
    _Capture.log = []
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Capture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    calls_log = paths["stub"] / "calls.log"
    calls_log.write_text("", encoding="utf-8")
    now = BASE_S + offset_s
    env = {
        "PATH": f"{paths['bin']}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "HOME": str(paths["home"]),
        "MC_STUB_DIR": str(paths["stub"]),
        "MC_API_URL": f"http://127.0.0.1:{server.server_address[1]}",
        "INGEST_TOKEN": "fixture-token",
        "MC_BRIDGE_STATE_FILE": str(state_dir / "last-run.json"),
        "MC_BRIDGE_STAMP_FILE": str(state_dir / "last-sync"),
        "OPENCLAW_CONFIG_PATH": str(paths["config"]),
        "OPENCLAW_GATEWAY_PORT": "9",
        "TZ": "UTC",
        **(extra_env or {}),
    }
    code = (
        "import runpy, sys, time\n"
        f"time.time = lambda: {now}.0\n"
        f"sys.argv = [{str(bridge)!r}] + {list(extra_args or [])!r}\n"
        f"runpy.run_path({str(bridge)!r}, run_name='__main__')\n"
    )
    try:
        proc = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=300)
    finally:
        server.shutdown()
        server.server_close()
    calls = [line for line in calls_log.read_text(encoding="utf-8").splitlines() if line]
    return {"code": proc.returncode, "stderr": proc.stderr, "requests": list(_Capture.log), "calls": calls}


def wire(result: Dict[str, Any]) -> bytes:
    """Every request the run sent, in order, as one byte string."""
    out = bytearray()
    for method, path, body in result["requests"]:
        out += f"{method} {path} {len(body)}\n".encode("utf-8") + body + b"\n"
    return bytes(out)
