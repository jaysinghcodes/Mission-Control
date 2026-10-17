"""The bridge default target follows MC_API_URL, MC_API_PORT, then PORT."""
import importlib.util
import os
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_api_url", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ApiUrlTest(unittest.TestCase):
    def setUp(self):
        self.mod = load()
        self.saved = {
            key: os.environ.get(key) for key in ("MC_API_URL", "MC_API_PORT", "PORT")
        }
        for key in self.saved:
            os.environ.pop(key, None)

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_defaults_to_port_3000(self):
        self.assertEqual(self.mod.default_api_url(), "http://127.0.0.1:3000")

    def test_port_is_the_native_listen_port(self):
        os.environ["PORT"] = "3405"
        self.assertEqual(self.mod.default_api_url(), "http://127.0.0.1:3405")

    def test_mc_api_port_wins_when_set(self):
        os.environ["PORT"] = "3000"
        os.environ["MC_API_PORT"] = "3880"
        self.assertEqual(self.mod.default_api_url(), "http://127.0.0.1:3880")

    def test_mc_api_url_wins(self):
        os.environ["MC_API_URL"] = "http://127.0.0.1:3405/"
        os.environ["PORT"] = "3000"
        os.environ["MC_API_PORT"] = "3880"
        self.assertEqual(self.mod.default_api_url(), "http://127.0.0.1:3405")
