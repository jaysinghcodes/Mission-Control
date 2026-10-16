"""devices.snapshot from openclaw devices list and openclaw nodes list."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"
FIXTURE = Path(__file__).resolve().parent / "examples" / "devices"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_devices", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class DevicesSnapshotTest(unittest.TestCase):
    def test_maps_paired_and_pending_without_tokens(self):
        mod = load()
        devices = json.loads((FIXTURE / "devices.json").read_text(encoding="utf-8"))
        nodes = json.loads((FIXTURE / "nodes.json").read_text(encoding="utf-8"))
        device_rows = mod.map_openclaw_devices(devices)
        node_rows = mod.map_openclaw_nodes(nodes)
        self.assertEqual([row["id"] for row in device_rows], ["mac-1", "pending:req-1"])
        self.assertEqual(device_rows[0]["type"], "operator")
        self.assertFalse(device_rows[0]["online"])
        self.assertIsNone(device_rows[0]["lastSeenAt"])
        self.assertIsNotNone(device_rows[0]["pairedAt"])
        self.assertIsNone(device_rows[0]["requestedAt"])
        self.assertEqual(device_rows[1]["name"], "New Phone")
        self.assertFalse(device_rows[1]["online"])
        self.assertEqual(device_rows[1]["type"], "pending")
        self.assertIsNone(device_rows[1]["lastSeenAt"])
        self.assertIsNone(device_rows[1]["pairedAt"])
        self.assertIsNotNone(device_rows[1]["requestedAt"])
        blob = json.dumps({"devices": device_rows, "nodes": node_rows})
        self.assertNotIn("secret-token", blob)
        by_id = {row["id"]: row for row in node_rows}
        self.assertEqual(set(by_id), {"mac-1", "phone-1"})
        self.assertEqual(by_id["mac-1"]["type"], "macos")
        self.assertTrue(by_id["mac-1"]["online"])
        self.assertIsNone(by_id["mac-1"]["lastSeenAt"])
        self.assertFalse(by_id["phone-1"]["online"])
        self.assertIsNotNone(by_id["phone-1"]["lastSeenAt"])
        self.assertIsNone(by_id["phone-1"]["requestedAt"])

    def test_unrecognized_shape_skips_and_empty_list_posts(self):
        mod = load()
        self.assertIsNone(mod.map_openclaw_devices(None))
        self.assertIsNone(mod.map_openclaw_devices({"nope": 1}))
        self.assertEqual(mod.map_openclaw_devices({"paired": [], "pending": []}), [])
        self.assertEqual(mod.map_openclaw_nodes({"nodes": []}), [])

    def test_status_overlay_marks_a_node_online(self):
        mod = load()
        listed = {
            "pending": [],
            "paired": [{"nodeId": "mac-1", "displayName": "Kitchen Mac", "platform": "macos"}],
        }
        self.assertTrue(mod.nodes_missing_connected(listed))
        merged = mod.overlay_node_status(
            listed,
            {"nodes": [{"nodeId": "mac-1", "connected": True, "connectedAtMs": 1710000002000}]},
        )
        rows = mod.map_openclaw_nodes(merged)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["online"])
        self.assertEqual(rows[0]["type"], "macos")

    def test_demo_id_is_dropped(self):
        mod = load()
        rows = mod.map_openclaw_devices(
            {"paired": [{"deviceId": "demo-device-studio", "displayName": "Stolen"}]}
        )
        self.assertEqual(rows, [])

    def test_dry_run_prints_devices_snapshot(self):
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--from-dir", str(FIXTURE)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        machines = [event for event in events if event.get("type") == "devices.snapshot"]
        self.assertEqual(len(machines), 1)
        payload = machines[0]["payload"]
        self.assertIn("mac-1", [row["id"] for row in payload["devices"]])
        self.assertIn("phone-1", [row["id"] for row in payload["nodes"]])
        self.assertNotIn("secret-token", json.dumps(payload))
        paired = next(row for row in payload["devices"] if row["id"] == "mac-1")
        self.assertFalse(paired["online"])
        self.assertIsNone(paired["lastSeenAt"])

    def test_dry_run_paired_device_without_connection_is_not_online(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "devices.json").write_text(
                json.dumps(
                    {
                        "paired": [
                            {
                                "deviceId": "studio-1",
                                "displayName": "Studio",
                                "roles": ["operator"],
                                "approvedAtMs": 1690000000000,
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            proc = subprocess.run(
                [sys.executable, str(BRIDGE), "--dry-run", "--from-dir", str(folder)],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        machines = [event for event in events if event.get("type") == "devices.snapshot"]
        self.assertEqual(len(machines), 1)
        payload = machines[0]["payload"]
        self.assertNotIn("nodes", payload)
        self.assertEqual(len(payload["devices"]), 1)
        row = payload["devices"][0]
        self.assertEqual(row["id"], "studio-1")
        self.assertFalse(row["online"])
        self.assertIsNone(row["lastSeenAt"])
        self.assertIsNotNone(row["pairedAt"])
        self.assertIsNone(row["requestedAt"])


if __name__ == "__main__":
    unittest.main()
