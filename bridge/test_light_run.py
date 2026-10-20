"""A steady state bridge run is light and sends what the main bridge sends (#118).

The fixture is 10 agents, 5,000 sessions and 500 memory files behind a
stub `openclaw` that logs each call. The parity hashes were taken from the
bridge on main (814727c) with the same fixture, the same stub outputs and
the same pinned clocks: a first run, a steady state run 5 minutes later,
and a run 61 minutes after the first. Set MC_PARITY_MAIN_BRIDGE to the
path of a main bridge copy to compare the bytes directly instead.
"""
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import light_fixture as lf  # noqa: E402

MAIN_HASHES = {
    0: "d52ffe2b984ad0d5ce2b8c967b5239cf1accbcbc9464b2f1bc285b80de86d09f",
    300: "c25922099b37b79a472155d274bbe2681431704c4cb58af24c4088b20fbb306f",
    3700: "043084bdba96890018fd999d174517eaebb70e49bb5b2f5bf0431e5aa3d63010",
}

FIRST_RUN_CALLS = sorted([
    "sessions --all-agents --json",
    "agents list --json",
    "cron list --all --json",
    "devices list --json",
    "nodes list --json",
    "models list --json",
    "--version",
])
STEADY_CALLS = ["sessions --all-agents --json"]


def profile_numbers(stderr: str):
    cpu = float(re.search(r"profile: CPU ([0-9.]+) s", stderr).group(1))
    mem = float(re.search(r"profile: peak memory ([0-9.]+) MB", stderr).group(1))
    calls = int(re.search(r"profile: openclaw calls (\d+)", stderr).group(1))
    return cpu, mem, calls


class LightRunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="mc-light-")
        root = Path(self.tmp.name)
        self.paths = lf.build(root)
        self.state = root / "state"
        self.state.mkdir()
        self.cache = self.state / "cli-cache.json"

    def tearDown(self):
        self.tmp.cleanup()

    def run_at(self, offset, args=None, env=None, bridge=lf.BRIDGE):
        result = lf.run(self.paths, offset, self.state, bridge=bridge, extra_args=args, extra_env=env)
        self.assertEqual(result["code"], 0, result["stderr"])
        return result

    def test_first_run_calls_every_source_once_and_steady_run_only_sessions(self):
        first = self.run_at(0)
        self.assertEqual(sorted(first["calls"]), FIRST_RUN_CALLS)
        steady = self.run_at(300, ["--profile"])
        self.assertEqual(steady["calls"], STEADY_CALLS)
        self.assertLessEqual(len(steady["calls"]), 2)
        self.assertIn("profile: openclaw calls 1", steady["stderr"])
        self.assertIn("profile: openclaw sessions --all-agents --json: 1", steady["stderr"])
        self.assertIn("profile: slow changing data read from the cache", steady["stderr"])
        self.assertIn("profile: memory files read 0, reused 500", steady["stderr"])

    def test_payload_is_byte_identical_to_main(self):
        main_bridge = os.environ.get("MC_PARITY_MAIN_BRIDGE", "").strip()
        expected = {}
        if main_bridge:
            other = Path(tempfile.mkdtemp(prefix="mc-light-main-"))
            paths = lf.build(other)
            state = other / "state"
            state.mkdir()
            for offset in (0, 300, 3700):
                ran = lf.run(paths, offset, state, bridge=Path(main_bridge))
                expected[offset] = hashlib.sha256(lf.wire(ran)).hexdigest()
        else:
            expected = MAIN_HASHES
        for offset in (0, 300, 3700):
            got = hashlib.sha256(lf.wire(self.run_at(offset))).hexdigest()
            self.assertEqual(got, expected[offset], f"run at +{offset} s")

    def test_openclaw_json_change_triggers_a_full_refresh(self):
        self.run_at(0)
        config = self.paths["config"]
        stat = config.stat()
        os.utime(config, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        changed = self.run_at(300, ["--profile"])
        self.assertEqual(sorted(changed["calls"]), FIRST_RUN_CALLS)
        self.assertIn("profile: slow changing data refreshed this run", changed["stderr"])
        self.assertEqual(self.run_at(600)["calls"], STEADY_CALLS)

    def test_an_hour_without_changes_triggers_a_full_refresh(self):
        self.run_at(0)
        self.assertEqual(self.run_at(3599)["calls"], STEADY_CALLS)
        self.assertEqual(sorted(self.run_at(3600)["calls"]), FIRST_RUN_CALLS)
        self.assertEqual(self.run_at(3900)["calls"], STEADY_CALLS)

    def test_refresh_interval_follows_the_environment(self):
        self.run_at(0)
        quick = {"MC_BRIDGE_REFRESH_SECONDS": "120"}
        self.assertEqual(sorted(self.run_at(300, env=quick)["calls"]), FIRST_RUN_CALLS)

    def test_a_missing_value_is_fetched_alone(self):
        self.run_at(0)
        body = json.loads(self.cache.read_text(encoding="utf-8"))
        del body["values"]["cron"]
        self.cache.write_text(json.dumps(body), encoding="utf-8")
        self.assertEqual(sorted(self.run_at(300)["calls"]), sorted(STEADY_CALLS + ["cron list --all --json"]))
        self.assertEqual(self.run_at(600)["calls"], STEADY_CALLS)

    def test_a_failed_call_is_not_cached(self):
        fail = {"MC_STUB_FAIL": "devices list --json"}
        first = self.run_at(0, env=fail)
        self.assertIn("devices list --json", first["calls"])
        self.assertNotIn("devices", json.loads(self.cache.read_text(encoding="utf-8"))["values"])
        again = self.run_at(300, env=fail)
        self.assertEqual(sorted(again["calls"]), sorted(STEADY_CALLS + ["devices list --json"]))

    def test_a_failed_sessions_call_asks_every_source_again(self):
        self.run_at(0)
        failed = self.run_at(300, env={"MC_STUB_FAIL": "sessions --all-agents --json"})
        self.assertEqual(sorted(failed["calls"]), FIRST_RUN_CALLS)

    def test_a_changed_memory_file_is_read_again(self):
        self.run_at(0)
        note = self.paths["root"] / "workspaces" / "agent03" / "MEMORY.md"
        note.write_text("# Agent 03 long term\n\nA new line.\n", encoding="utf-8")
        os.utime(note, (lf.BASE_S, lf.BASE_S))
        later = self.run_at(300, ["--profile"])
        self.assertIn("profile: memory files read 1, reused 499", later["stderr"])
        memory = [json.loads(body) for _, _, body in later["requests"] if b'"memory.snapshot"' in body[:40]]
        self.assertEqual(len(memory), 1)
        bodies = [row["body"] for row in memory[0]["payload"]["entries"] if row["ref"] == "MEMORY.md" and row["agent"] == "Agent 03"]
        self.assertEqual(bodies, ["# Agent 03 long term\n\nA new line."])

    def test_dry_run_writes_no_cache(self):
        result = self.run_at(0, ["--dry-run"])
        self.assertEqual(sorted(result["calls"]), FIRST_RUN_CALLS)
        self.assertFalse(self.cache.exists())

    def test_profile_meets_the_targets_with_child_processes(self):
        first = self.run_at(0, ["--profile"])
        steady = self.run_at(300, ["--profile"])
        for result in (first, steady):
            cpu, mem, _ = profile_numbers(result["stderr"])
            self.assertLess(cpu, 10.0, result["stderr"])
            self.assertLess(mem, 150.0, result["stderr"])
        self.assertRegex(first["stderr"], r"profile: CPU [0-9.]+ s \(bridge [0-9.]+ s, child processes [0-9.]+ s\)")
        self.assertEqual(profile_numbers(first["stderr"])[2], 7)
        self.assertEqual(profile_numbers(steady["stderr"])[2], 1)
        for line in first["stderr"].splitlines():
            if "profile:" in line:
                self.assertIsNone(re.search(r"[\u2012-\u2015\u2190-\u21ff]| - ", line), line)


class MemoryReadTest(unittest.TestCase):
    def test_chunked_read_matches_text_mode(self):
        spec = importlib.util.spec_from_file_location("bridge_sync_light", lf.BRIDGE)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "note.md"
            path.write_bytes(b"one\r\ntwo\rthree\n\xff end " + b"x" * 200_000)
            self.assertEqual(mod._read_memory_text(path), path.read_text(encoding="utf-8", errors="replace"))
            big = Path(tmp) / "big.md"
            big.write_bytes(b"y" * (mod.MAX_MEMORY_BYTES + 1))
            self.assertIsNone(mod._read_memory_text(big))


if __name__ == "__main__":
    unittest.main()
