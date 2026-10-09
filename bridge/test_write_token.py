"""POST /events always sends x-ingest-token and never puts it in the body."""
import importlib.util
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class PostHeaderTest(unittest.TestCase):
    def test_post_sends_header_and_keeps_token_out_of_the_body(self):
        mod = load()
        seen = {}

        class Resp:
            status = 202

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=15):
            seen["url"] = req.full_url
            seen["header"] = req.get_header("X-ingest-token")
            seen["data"] = req.data
            return Resp()

        original = mod.urllib.request.urlopen
        mod.urllib.request.urlopen = urlopen
        try:
            ok = mod.post(
                "http://127.0.0.1:3000",
                "super-secret",
                "health.tick",
                {"uptimeSeconds": 1},
            )
        finally:
            mod.urllib.request.urlopen = original

        self.assertTrue(ok)
        self.assertEqual(seen["url"], "http://127.0.0.1:3000/events")
        self.assertEqual(seen["header"], "super-secret")
        self.assertNotIn(b"super-secret", seen["data"])


if __name__ == "__main__":
    unittest.main()
