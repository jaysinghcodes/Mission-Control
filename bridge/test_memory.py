"""memory.snapshot: OpenClaw MEMORY.md + memory/YYYY-MM-DD*.md, stable ids."""
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"
SAMPLE = Path(__file__).resolve().parent / "examples" / "openclaw-memory"
EXAMPLES = Path(__file__).resolve().parent / "examples"


def load():
    import importlib.util

    spec = importlib.util.spec_from_file_location("mc_bridge_sync", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class MemoryMapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_sample_tree_kinds_and_stable_ids(self):
        agents = self.mod.agents_from_memory_dir(SAMPLE)
        self.assertIsNotNone(agents)
        first = self.mod.collect_memory(agents)
        second = self.mod.collect_memory(agents)
        self.assertIsNotNone(first)
        ids = [row["id"] for row in first]
        self.assertEqual(ids, [row["id"] for row in second])
        self.assertEqual(len(ids), len(set(ids)))
        by_ref = {row["ref"]: row for row in first}
        self.assertEqual(by_ref["MEMORY.md"]["kind"], "long-term")
        self.assertIn("memory/2026-10-05.md", by_ref)
        self.assertEqual(by_ref["memory/2026-10-05.md"]["kind"], "daily")
        self.assertEqual(by_ref["memory/2026-10-05-review.md"]["kind"], "daily")
        self.assertNotIn("USER.md", by_ref)
        self.assertNotIn("memory/notes.txt", by_ref)
        self.assertNotIn("memory/2026-13-01.md", by_ref)
        self.assertNotIn("memory/.dreams/secret.md", by_ref)
        forge = [row for row in first if row["agent"] == "Forge"]
        aegis = [row for row in first if row["agent"] == "Aegis"]
        self.assertGreaterEqual(len(forge), 3)
        self.assertGreaterEqual(len(aegis), 2)
        # Same path always hashes to the same id.
        self.assertEqual(
            self.mod.memory_stable_id("Forge", "MEMORY.md"),
            self.mod.memory_stable_id("Forge", "MEMORY.md"),
        )
        self.assertNotEqual(
            self.mod.memory_stable_id("Forge", "MEMORY.md"),
            self.mod.memory_stable_id("Aegis", "MEMORY.md"),
        )

    def test_missing_workspaces_do_not_become_an_empty_snapshot(self):
        rows = self.mod.collect_memory([
            {"id": "ghost", "name": "Ghost", "workspace": "/this/path/does/not/exist"},
        ])
        self.assertIsNone(rows)

    def test_mtime_is_the_saved_instant(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "openclaw-memory"
            shutil.copytree(SAMPLE, root)
            note = root / "Aegis" / "memory" / "2026-01-15.md"
            # 2026-01-15 23:58 America/Chicago (CST) = 2026-01-16T05:58:00Z
            stamp = datetime.datetime(2026, 1, 16, 5, 58, tzinfo=datetime.timezone.utc).timestamp()
            os.utime(note, (stamp, stamp))
            rows = self.mod.collect_memory(self.mod.agents_from_memory_dir(root))
            hit = next(row for row in rows if row["ref"] == "memory/2026-01-15.md")
            self.assertEqual(hit["createdAt"], "2026-01-16T05:58:00Z")
            self.assertEqual(hit["agent"], "Aegis")


class MemoryDryRunTest(unittest.TestCase):
    def test_dry_run_prints_memory_events(self):
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--memory-dir", str(SAMPLE)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("INGEST_TOKEN", proc.stdout)
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        memory = [event for event in events if event["type"] == "memory.snapshot"]
        self.assertEqual(len(memory), 1)
        entries = memory[0]["payload"]["entries"]
        self.assertGreaterEqual(len(entries), 4)
        ids = [row["id"] for row in entries]
        self.assertEqual(len(ids), len(set(ids)))
        kinds = {row["kind"] for row in entries}
        self.assertIn("long-term", kinds)
        self.assertIn("daily", kinds)
        refs = {row["ref"] for row in entries}
        self.assertIn("MEMORY.md", refs)
        self.assertNotIn("USER.md", refs)

        again = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--memory-dir", str(SAMPLE)],
            capture_output=True,
            text=True,
            check=False,
        )
        again_events = [json.loads(line) for line in again.stdout.splitlines() if line.strip()]
        again_memory = [event for event in again_events if event["type"] == "memory.snapshot"]
        again_ids = [row["id"] for row in again_memory[0]["payload"]["entries"]]
        self.assertEqual(ids, again_ids)

    def test_from_dir_without_workspaces_does_not_emit_memory(self):
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--from-dir", str(EXAMPLES)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        self.assertTrue(events)
        self.assertFalse(any(event["type"] == "memory.snapshot" for event in events))

    def test_missing_memory_dir_skips(self):
        missing = SAMPLE.parent / "no-such-memory-dir"
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--memory-dir", str(missing)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), "")
        self.assertIn("not found", proc.stderr)


if __name__ == "__main__":
    unittest.main()
