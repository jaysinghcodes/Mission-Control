"""Usage lines: tokens, optional costUsd, local providers, day and bot grouping."""
import datetime
import importlib.util
import unittest
from pathlib import Path

NOW = int(datetime.datetime(2026, 10, 9, 18, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
UTC = datetime.timezone.utc


def load():
    path = Path(__file__).resolve().parent / "mc-bridge-sync.py"
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_prices", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class UsagePriceLinesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def points(self, sessions, prior=None, local_names=None):
        payload, state = self.mod.usage_points_from_sessions(
            sessions, NOW, prior, local_names, UTC
        )
        return payload, state

    def test_omits_cost_usd_when_the_session_did_not_report_one(self):
        payload, _state = self.points([{
            "name": "s1",
            "agent": "Quill",
            "model": "openai/gpt-4.1",
            "_updatedMs": NOW,
            "_cost": None,
            "_in": 1000,
            "_out": 200,
        }])
        line = payload["points"][0]["providers"][0]
        self.assertEqual(line["bot"], "Quill")
        self.assertEqual(line["model"], "openai/gpt-4.1")
        self.assertEqual(line["tokensIn"], 1000)
        self.assertEqual(line["tokensOut"], 200)
        self.assertNotIn("costUsd", line)
        self.assertEqual(payload["points"][0]["totalCost"], 0)

    def test_cost_usd_is_sent_when_present_including_zero(self):
        payload, _state = self.points([{
            "name": "s1",
            "agent": "Sage",
            "model": "anthropic/claude-sonnet-4-6",
            "_updatedMs": NOW,
            "_cost": 0,
            "_in": 10,
            "_out": 4,
        }])
        line = payload["points"][0]["providers"][0]
        self.assertEqual(line["costUsd"], 0)
        self.assertEqual(line["bot"], "Sage")

    def test_ollama_is_local_and_a_marked_provider_is_local(self):
        payload, _state = self.points(
            [
                {
                    "name": "local",
                    "agent": "Local",
                    "model": "ollama/llama3.1",
                    "_updatedMs": NOW,
                    "_cost": None,
                    "_in": 50,
                    "_out": 8,
                },
                {
                    "name": "studio",
                    "agent": "Bench",
                    "model": "lmstudio/local-chat",
                    "_updatedMs": NOW,
                    "_cost": None,
                    "_in": 20,
                    "_out": 2,
                },
            ],
            local_names={"ollama", "lmstudio"},
        )
        by_bot = {row["bot"]: row for row in payload["points"][0]["providers"]}
        self.assertTrue(by_bot["Local"]["local"])
        self.assertNotIn("costUsd", by_bot["Local"])
        self.assertTrue(by_bot["Bench"]["local"])

    def test_groups_two_bots_on_one_model_and_two_days(self):
        day = NOW - 86_400_000
        payload, _state = self.points([
            {
                "name": "a",
                "agent": "Quill",
                "model": "openai/gpt-4.1",
                "_updatedMs": day,
                "_cost": None,
                "_in": 10,
                "_out": 1,
            },
            {
                "name": "b",
                "agent": "Sage",
                "model": "openai/gpt-4.1",
                "_updatedMs": NOW,
                "_cost": 1.5,
                "_in": 20,
                "_out": 2,
            },
        ])
        self.assertEqual(len(payload["points"]), 2)
        bots = []
        for point in payload["points"]:
            for row in point["providers"]:
                bots.append((row["bot"], row["model"], row["tokensIn"]))
        self.assertEqual(
            bots,
            [
                ("Quill", "openai/gpt-4.1", 10),
                ("Sage", "openai/gpt-4.1", 20),
            ],
        )

    def test_reported_cost_does_not_hide_tokens_without_a_cost(self):
        payload, _state = self.points([
            {
                "name": "run-a",
                "agent": "Speedy",
                "model": "deepseek/deepseek-chat",
                "_updatedMs": NOW,
                "_cost": None,
                "_in": 1_000_000,
                "_out": 1_000_000,
            },
            {
                "name": "run-b",
                "agent": "Speedy",
                "model": "deepseek/deepseek-chat",
                "_updatedMs": NOW,
                "_cost": 0.5,
                "_in": 1_000_000,
                "_out": 0,
            },
        ])
        rows = payload["points"][0]["providers"]
        self.assertEqual(len(rows), 2)
        open_line = next(row for row in rows if "costUsd" not in row)
        reported = next(row for row in rows if row.get("costUsd") == 0.5)
        self.assertEqual(open_line["bot"], "Speedy")
        self.assertEqual(open_line["model"], "deepseek/deepseek-chat")
        self.assertEqual(open_line["tokensIn"], 1_000_000)
        self.assertEqual(open_line["tokensOut"], 1_000_000)
        self.assertEqual(reported["bot"], "Speedy")
        self.assertEqual(reported["model"], "deepseek/deepseek-chat")
        self.assertEqual(reported["tokensIn"], 1_000_000)
        self.assertEqual(reported["tokensOut"], 0)

    def test_config_local_flag(self):
        names = self.mod.local_provider_names({
            "models": {
                "providers": {
                    "lmstudio": {"local": True, "api": "openai-completions"},
                    "openai": {"api": "openai-completions"},
                    "box": {"api": "ollama"},
                }
            }
        })
        self.assertIn("ollama", names)
        self.assertIn("lmstudio", names)
        self.assertIn("box", names)
        self.assertNotIn("openai", names)


class ModelProviderKeyTest(unittest.TestCase):
    """OpenClaw sends modelProvider and a bare model. Usage prices provider/model."""

    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def lines(self, rows):
        sessions = self.mod.map_sessions(rows, NOW)
        payload, _state = self.mod.usage_points_from_sessions(sessions, NOW, None, None, UTC)
        return {line["model"]: line for line in payload["points"][0]["providers"]}, sessions

    def row(self, key, provider, model):
        return {
            "key": key,
            "agentId": "speedy",
            "modelProvider": provider,
            "model": model,
            "updatedAt": NOW,
            "inputTokens": 1000,
            "outputTokens": 250,
        }

    def test_a_bare_model_gets_its_provider_in_front(self):
        lines, sessions = self.lines([
            self.row("agent:speedy:main", "deepseek", "deepseek-v4-flash"),
            self.row("agent:quill:main", "openai", "gpt-4.1"),
        ])
        self.assertIn("deepseek/deepseek-v4-flash", lines)
        self.assertEqual(lines["deepseek/deepseek-v4-flash"]["provider"], "deepseek")
        self.assertIn("openai/gpt-4.1", lines)
        # The session row keeps the model as OpenClaw sent it.
        self.assertEqual(sorted(s["model"] for s in sessions), ["deepseek-v4-flash", "gpt-4.1"])

    def test_an_openrouter_run_is_keyed_to_the_openrouter_row(self):
        lines, _sessions = self.lines([
            self.row("agent:a:main", "openrouter", "deepseek/deepseek-v4-flash"),
            self.row("agent:b:main", "openrouter", "deepseek-v4-flash"),
        ])
        self.assertIn("openrouter/deepseek/deepseek-v4-flash", lines)
        self.assertEqual(lines["openrouter/deepseek/deepseek-v4-flash"]["provider"], "openrouter")
        self.assertIn("openrouter/deepseek-v4-flash", lines)
        self.assertNotIn("deepseek/deepseek-v4-flash", lines)

    def test_a_prefixed_name_is_kept_as_is(self):
        lines, _sessions = self.lines([
            self.row("agent:a:main", "openrouter", "openrouter/deepseek/deepseek-v4-flash"),
            self.row("agent:b:main", "anthropic", "anthropic/claude-sonnet-4-6"),
            {"key": "agent:c:main", "agentId": "c", "model": "openai/gpt-4.1", "updatedAt": NOW, "inputTokens": 5, "outputTokens": 5},
        ])
        self.assertEqual(
            sorted(lines),
            ["anthropic/claude-sonnet-4-6", "openai/gpt-4.1", "openrouter/deepseek/deepseek-v4-flash"],
        )

    def test_price_model_rules(self):
        pm = self.mod.price_model
        self.assertEqual(pm("deepseek", "deepseek-v4-flash"), "deepseek/deepseek-v4-flash")
        self.assertEqual(pm("openrouter", "deepseek/deepseek-v4-flash"), "openrouter/deepseek/deepseek-v4-flash")
        self.assertEqual(pm("OpenRouter", "openrouter/auto"), "openrouter/auto")
        self.assertEqual(pm(None, "gpt-4.1"), "gpt-4.1")
        self.assertEqual(pm("", "openai/gpt-4.1"), "openai/gpt-4.1")
        self.assertIsNone(pm("openai", None))

    def test_a_bare_local_model_is_still_local(self):
        lines, _sessions = self.lines([self.row("agent:a:main", "ollama", "llama3.1")])
        self.assertTrue(lines["ollama/llama3.1"].get("local"))


if __name__ == "__main__":
    unittest.main()
