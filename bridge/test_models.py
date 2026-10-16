"""models.snapshot from openclaw.json, with `openclaw models list` as fallback."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"
FIXTURE = Path(__file__).resolve().parent / "examples" / "models"
EXAMPLES = Path(__file__).resolve().parent / "examples"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_models", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ModelsSnapshotTest(unittest.TestCase):
    def test_fixture_lists_six_providers(self):
        mod = load()
        payload = mod.collect_models(mod.Sources(FIXTURE), FIXTURE)
        self.assertIsNotNone(payload)
        providers = [row["provider"] for row in payload["agents"]]
        self.assertEqual(
            providers,
            ["openai", "anthropic", "deepseek", "openrouter", "google", "ollama"],
        )
        names = [row["name"] for row in payload["agents"]]
        self.assertEqual(names, ["Quill", "Sage", "Nova", "Router", "Lens", "Local"])
        router = next(row for row in payload["agents"] if row["id"] == "router")
        self.assertEqual(router["model"], "anthropic/claude-sonnet-4-6")
        self.assertEqual(payload["openclawVersion"], "2026.10.15")
        self.assertEqual(payload["models"], [])

    def test_json5_comments_and_trailing_commas(self):
        mod = load()
        quoted = """
        {
          // default agent only
          "meta": { "lastTouchedVersion": "2026.10.15", },
          "agents": {
            "defaults": { "model": { "primary": "ollama/llama3.1", }, },
          },
        }
        """
        cfg = mod.parse_config_json(quoted)
        payload = mod.models_from_config(cfg)
        self.assertEqual(payload["agents"][0]["provider"], "ollama")
        self.assertEqual(payload["agents"][0]["model"], "llama3.1")
        self.assertEqual(payload["openclawVersion"], "2026.10.15")

    def test_plain_list_and_json_list(self):
        mod = load()
        text = "Model\nopenai/gpt-4.1\nanthropic/claude-sonnet-4-6 default\n# skip\n"
        rows = mod.models_from_list_text(text)
        self.assertEqual(rows[0], {"provider": "openai", "model": "gpt-4.1"})
        self.assertEqual(rows[1]["provider"], "anthropic")
        parsed = mod.models_from_list_payload(
            {
                "models": [
                    {"key": "deepseek/deepseek-chat"},
                    {"provider": "gemini", "id": "gemini-2.5-flash"},
                    {"provider": "openrouter", "model": "openai/gpt-4.1"},
                ]
            }
        )
        self.assertEqual(
            [row["provider"] for row in parsed],
            ["deepseek", "gemini", "openrouter"],
        )

    def test_missing_fixture_file_skips(self):
        mod = load()
        payload = mod.collect_models(mod.Sources(EXAMPLES), EXAMPLES)
        self.assertIsNone(payload)

    def test_readable_config_with_no_models_posts_empty(self):
        mod = load()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "openclaw.json"
            path.write_text('{"agents": {"entries": {"main": {"name": "Main"}}}}', encoding="utf-8")
            payload = mod.collect_models(mod.Sources(Path(tmp)), Path(tmp))
        self.assertEqual(payload["agents"], [])
        self.assertEqual(payload["models"], [])
        self.assertNotIn("openclawVersion", payload)

    def test_dry_run_prints_models_snapshot(self):
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run", "--from-dir", str(FIXTURE)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        models = [event for event in events if event.get("type") == "models.snapshot"]
        self.assertEqual(len(models), 1)
        self.assertEqual(len(models[0]["payload"]["agents"]), 6)

    def test_version_line_keeps_the_cli_text(self):
        mod = load()
        self.assertEqual(mod.version_line("OpenClaw 2026.10.15\n"), "OpenClaw 2026.10.15")
        self.assertIsNone(mod.version_line("  \n"))
