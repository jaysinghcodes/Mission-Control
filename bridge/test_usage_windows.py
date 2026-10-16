"""Daily usage points: backfill, two simulated days, no period totals."""
import datetime
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

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

    def test_named_zone_buckets_the_local_day(self):
        zone = self.mod.iana_zone("Europe/Berlin")
        self.assertIsNotNone(zone)
        instant = int(datetime.datetime(2026, 1, 15, 23, 30, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        _payload, state = self.mod.usage_points_from_sessions(
            [session("a", instant, "zai/glm", 1)],
            instant,
            None,
            None,
            zone,
        )
        self.assertEqual(list(state["days"]), ["2026-01-16"])

    def test_calcutta_kolkata_and_kyiv_share_the_api_day(self):
        instant = datetime.datetime(2026, 1, 15, 23, 30, tzinfo=datetime.timezone.utc)
        cases = (
            ("Asia/Calcutta", "Asia/Kolkata", "2026-01-16"),
            ("Asia/Kolkata", "Asia/Kolkata", "2026-01-16"),
            ("Europe/Kyiv", "Europe/Kyiv", "2026-01-16"),
            ("Europe/Kiev", "Europe/Kyiv", "2026-01-16"),
        )
        for raw, canonical, day in cases:
            self.assertEqual(self.mod.canonical_zone(raw), canonical)
            zone = self.mod.iana_zone(raw)
            self.assertIsNotNone(zone)
            self.assertEqual(getattr(zone, "key", None), canonical)
            self.assertEqual(self.mod.zone_day_of(instant, zone), day)
        saved = os.environ.get("MC_TIMEZONE")
        try:
            os.environ["MC_TIMEZONE"] = "Asia/Calcutta"
            zone = self.mod.resolve_tz(None)
            self.assertEqual(getattr(zone, "key", None), "Asia/Kolkata")
            self.assertEqual(self.mod.zone_day_of(instant, zone), "2026-01-16")
        finally:
            if saved is None:
                os.environ.pop("MC_TIMEZONE", None)
            else:
                os.environ["MC_TIMEZONE"] = saved

    def test_every_list_entry_loads_in_zoneinfo(self):
        table = json.loads(self.mod.timezones_file().read_text(encoding="utf-8"))
        zones = table["zones"]
        self.assertIn("Asia/Kolkata", zones)
        self.assertIn("Europe/Kyiv", zones)
        self.assertNotIn("Asia/Calcutta", zones)
        self.assertNotIn("Europe/Kiev", zones)
        for name in zones:
            ZoneInfo(name)
        for src, dst in table["legacy"].items():
            self.assertIn(dst, zones)
            self.assertEqual(self.mod.canonical_zone(src), dst)

    def test_host_fallback_reads_the_localtime_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            link = Path(tmp) / "localtime"
            link.symlink_to("/usr/share/zoneinfo/Asia/Calcutta")
            self.assertEqual(self.mod.host_zone_name(str(link)), "Asia/Kolkata")
            link.unlink()
            link.symlink_to("/usr/share/zoneinfo/Etc/UTC")
            self.assertEqual(self.mod.host_zone_name(str(link)), "UTC")
        saved = {key: os.environ.get(key) for key in ("MC_TIMEZONE", "TZ")}
        try:
            os.environ["MC_TIMEZONE"] = "CST"
            os.environ["TZ"] = "+02:00"
            zone = self.mod.resolve_tz(None)
            host = self.mod.host_zone_name()
            if host:
                self.assertEqual(getattr(zone, "key", None), host)
            else:
                self.assertEqual(zone, datetime.timezone.utc)
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_offset_and_abbreviation_are_not_zones(self):
        self.assertIsNone(self.mod.iana_zone("+02:00"))
        self.assertIsNone(self.mod.iana_zone("CST"))
        self.assertFalse(self.mod.zone_name_allowed("+02:00"))
        self.assertFalse(self.mod.zone_name_allowed("CST"))
        self.assertIsNotNone(self.mod.iana_zone("UTC"))
        self.assertIsNotNone(self.mod.iana_zone("Europe/Berlin"))

    def test_env_fallbacks_ignore_offset_and_abbreviation(self):
        saved = {key: os.environ.get(key) for key in ("MC_TIMEZONE", "TZ")}
        try:
            os.environ["MC_TIMEZONE"] = "CST"
            os.environ["TZ"] = "+02:00"
            for candidate in (None, "CST", "+02:00"):
                zone = self.mod.resolve_tz(candidate)
                key = getattr(zone, "key", None)
                if key:
                    self.assertNotIn(key, ("CST", "+02:00"))
                    self.assertIsNotNone(self.mod.iana_zone(key))
                else:
                    self.assertEqual(
                        zone.utcoffset(datetime.datetime(2026, 1, 15, 23, 30)),
                        datetime.timedelta(0),
                    )
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
