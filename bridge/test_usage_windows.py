"""usage_from_sessions windows: 24h, 7d, and a UTC calendar month."""
import datetime
import importlib.util
import unittest
from pathlib import Path

DAY = 86_400_000
NOW = 1_700_000_000_000


def load():
    path = Path(__file__).resolve().parent / "mc-bridge-sync.py"
    spec = importlib.util.spec_from_file_location("mc_bridge_sync", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def session(age_ms, model, cost):
    return {
        "model": model,
        "_updatedMs": NOW - age_ms,
        "_cost": cost,
        "_in": 10,
        "_out": 5,
    }


class UsageWindowsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def rollup(self, period, window_ms):
        sessions = [
            session(60 * 60 * 1000, "zai/glm", 1),
            session(3 * DAY, "deepseek/x", 2),
            session(20 * DAY, "ollama/q", 4),
            session(40 * DAY, "old/m", 8),
        ]
        return self.mod.usage_from_sessions(sessions, NOW, period, window_ms)

    def test_24h_excludes_older_sessions(self):
        snap = self.rollup("24h", DAY)
        self.assertEqual(snap["period"], "24h")
        self.assertEqual(snap["totalCost"], 1)
        self.assertEqual([p["model"] for p in snap["providers"]], ["zai/glm"])

    def test_7d_includes_three_day_session(self):
        snap = self.rollup("7d", 7 * DAY)
        self.assertEqual(snap["period"], "7d")
        self.assertEqual(snap["totalCost"], 3)
        self.assertEqual(sorted(p["model"] for p in snap["providers"]), ["deepseek/x", "zai/glm"])

    def test_month_is_calendar_month_to_date(self):
        # NOW is 2023-11-14. A session 20 days old is still in October.
        sessions = [
            session(60 * 60 * 1000, "zai/glm", 1),
            session(3 * DAY, "deepseek/x", 2),
            session(20 * DAY, "ollama/q", 4),
            session(40 * DAY, "old/m", 8),
        ]
        snap = self.mod.usage_from_sessions(sessions, NOW, "month")
        self.assertEqual(snap["period"], "month")
        self.assertEqual(snap["totalCost"], 3)
        models = {p["model"] for p in snap["providers"]}
        self.assertNotIn("ollama/q", models)
        self.assertNotIn("old/m", models)
        start = self.mod.month_start_utc_ms(NOW)
        stamp = datetime.datetime.fromtimestamp(start / 1000, datetime.timezone.utc).isoformat()
        self.assertEqual(stamp, "2023-11-01T00:00:00+00:00")

    def test_default_call_is_24h(self):
        sessions = [session(2 * DAY, "zai/glm", 9), session(1000, "zai/glm", 1)]
        snap = self.mod.usage_from_sessions(sessions, NOW)
        self.assertEqual(snap["period"], "24h")
        self.assertEqual(snap["totalCost"], 1)


if __name__ == "__main__":
    unittest.main()
