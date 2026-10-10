"""Daily usage points: backfill, two simulated days, no period totals."""
import datetime
import importlib.util
import unittest
from pathlib import Path

DAY = 86_400_000
# 2026-10-09 18:00 UTC is 13:00 CDT, clear of midnight and of the November DST end.
NOW = int(datetime.datetime(2026, 10, 9, 18, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def load():
    path = Path(__file__).resolve().parent / "mc-bridge-sync.py"
    spec = importlib.util.spec_from_file_location("mc_bridge_sync", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def session(name, at_ms, model, cost, tokens_in=10, tokens_out=5):
    return {
        "name": name,
        "model": model,
        "_updatedMs": at_ms,
        "_cost": cost,
        "_in": tokens_in,
        "_out": tokens_out,
    }


class UsagePointsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_payload_has_no_period_total(self):
        payload, _state = self.mod.usage_points_from_sessions(
            [session("a", NOW, "zai/glm", 1)],
            NOW,
            None,
        )
        self.assertNotIn("period", payload)
        self.assertEqual(payload["points"][0]["totalCost"], 1)
        self.assertNotIn("period", payload["points"][0])

    def test_backfill_caps_at_30_days(self):
        sessions = [
            session(f"s{i}", NOW - i * DAY, "zai/glm", 1)
            for i in range(40)
        ]
        payload, _state = self.mod.usage_points_from_sessions(sessions, NOW, None)
        self.assertEqual(len(payload["points"]), 30)
        self.assertEqual(sum(p["totalCost"] for p in payload["points"]), 30)

    def test_no_timestamp_collects_only_the_sync_day(self):
        sessions = [{
            "name": "a",
            "model": "zai/glm",
            "_updatedMs": None,
            "_cost": 4,
            "_in": 3,
            "_out": 1,
        }]
        payload, state = self.mod.usage_points_from_sessions(sessions, NOW, None)
        self.assertEqual(len(payload["points"]), 1)
        self.assertEqual(payload["points"][0]["totalCost"], 4)
        self.assertEqual(len(state["days"]), 1)

    def test_history_older_than_30_days_is_not_invented(self):
        old = NOW - 40 * DAY
        payload, state = self.mod.usage_points_from_sessions(
            [session("a", old, "zai/glm", 8)],
            NOW,
            None,
        )
        self.assertEqual(sum(p["totalCost"] for p in payload["points"]), 0)
        now2 = NOW + DAY
        payload2, _state2 = self.mod.usage_points_from_sessions(
            [session("a", now2, "zai/glm", 9, 2, 1)],
            now2,
            state,
        )
        self.assertEqual(sum(p["totalCost"] for p in payload2["points"]), 1)
        self.assertTrue(any(p["totalCost"] == 1 for p in payload2["points"]))

    def test_two_simulated_days_both_stay_in_the_payload(self):
        day1 = NOW - DAY
        sessions1 = [session("alpha", day1, "zai/glm", 1)]
        payload1, state = self.mod.usage_points_from_sessions(sessions1, day1, None)
        self.assertEqual(len(payload1["points"]), 1)
        self.assertEqual(payload1["points"][0]["totalCost"], 1)

        sessions2 = [
            session("alpha", NOW, "zai/glm", 1.5, 12, 6),
            session("beta", NOW, "deepseek/x", 2, 8, 3),
        ]
        payload2, _state = self.mod.usage_points_from_sessions(sessions2, NOW, state)
        by_cost = sorted(p["totalCost"] for p in payload2["points"])
        # Day 1 keeps the original 1. Day 2 is the 0.5 increase plus the new session.
        self.assertEqual(by_cost, [1, 2.5])
        self.assertEqual(sum(by_cost), 3.5)
        self.assertGreaterEqual(len(payload2["points"]), 2)


if __name__ == "__main__":
    unittest.main()
