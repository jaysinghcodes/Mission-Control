"""Stable agent slugs and optional self registration. OpenClaw stays optional."""
import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"
EXAMPLES = Path(__file__).resolve().parent / "examples"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_agents", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class AgentSlugTest(unittest.TestCase):
    def test_map_agents_uses_a_stable_slug_id(self):
        mod = load()
        mapped = mod.map_agents(
            [
                {"id": "main", "identityName": "Example Lead", "isDefault": True},
                {"id": "550E8400-E29B-41D4-A716-446655440000", "name": "Nova"},
            ],
            [],
        )
        self.assertEqual(mapped[0]["id"], "main")
        self.assertEqual(mapped[1]["id"], "550e8400_e29b_41d4_a716_446655440000")
        self.assertTrue(mod.agent_slug("Demo Lead") == "demo_lead")

    def test_register_is_off_unless_asked(self):
        mod = load()
        previous = os.environ.pop("MC_BRIDGE_REGISTER", None)
        try:
            self.assertFalse(mod.wants_self_register())
            os.environ["MC_BRIDGE_REGISTER"] = "1"
            self.assertTrue(mod.wants_self_register())
        finally:
            if previous is None:
                os.environ.pop("MC_BRIDGE_REGISTER", None)
            else:
                os.environ["MC_BRIDGE_REGISTER"] = previous

    def test_register_payload_matches_the_route(self):
        mod = load()
        bodies = mod.register_payloads(
            [{"id": "forge_helper", "name": "Forge Helper", "role": "engineer", "emoji": "🔧"}]
        )
        self.assertEqual(
            bodies,
            [{
                "id": "forge_helper",
                "name": "Forge Helper",
                "role": "engineer",
                "avatar": "🔧",
            }],
        )

    def test_dry_run_from_examples_does_not_register_unless_asked(self):
        env = os.environ.copy()
        # Pin off. The bridge loads repo .env when this variable is absent,
        # and a fresh install sets MC_BRIDGE_REGISTER=1 there.
        env["MC_BRIDGE_REGISTER"] = "0"
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--from-dir", str(EXAMPLES)],
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        agents = [event for event in lines if event.get("type") == "agents.snapshot"]
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["payload"]["agents"][0]["id"], "main")
        self.assertFalse(any(event.get("call") == "POST /agents/register" for event in lines))

        env["MC_BRIDGE_REGISTER"] = "1"
        opted = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--from-dir", str(EXAMPLES)],
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )
        self.assertEqual(opted.returncode, 0, opted.stderr)
        opted_lines = [json.loads(line) for line in opted.stdout.splitlines() if line.strip()]
        calls = [event for event in opted_lines if event.get("call") == "POST /agents/register"]
        self.assertGreaterEqual(len(calls), 1)
        self.assertEqual(calls[0]["body"]["id"], "main")
        self.assertIn("name", calls[0]["body"])


if __name__ == "__main__":
    unittest.main()
