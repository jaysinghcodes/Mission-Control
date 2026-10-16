"""Fixture OpenClaw output used by the fresh install bridge check."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"
FIXTURE = Path(__file__).resolve().parent / "examples" / "fresh-install"


class FreshInstallFixtureTest(unittest.TestCase):
    def test_dry_run_prints_devices_nodes_approvals_and_gateway(self):
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--from-dir", str(FIXTURE)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        by_type = {event["type"]: event["payload"] for event in events}
        self.assertIn("fresh-studio", [row["id"] for row in by_type["devices.snapshot"]["devices"]])
        self.assertIn("pending:req-fresh", [row["id"] for row in by_type["devices.snapshot"]["devices"]])
        self.assertEqual([row["id"] for row in by_type["devices.snapshot"]["nodes"]], ["fresh-node"])
        self.assertTrue(by_type["devices.snapshot"]["nodes"][0]["online"])
        self.assertEqual(by_type["approvals.snapshot"]["approvals"][0]["tag"], "FreshInstall")
        self.assertEqual(by_type["approvals.snapshot"]["approvals"][0]["kind"], "exec")
        self.assertEqual(by_type["gateway.snapshot"]["host"], "127.0.0.1")
        self.assertIsInstance(by_type["gateway.snapshot"]["up"], bool)
        self.assertIsInstance(by_type["gateway.snapshot"]["port"], int)
        self.assertIsInstance(by_type["gateway.snapshot"]["checkedAt"], int)


if __name__ == "__main__":
    unittest.main()
