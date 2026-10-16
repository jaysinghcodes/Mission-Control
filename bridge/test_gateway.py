"""The bridge probes 127.0.0.1 and posts gateway.snapshot with x-ingest-token."""
import importlib.util
import json
import os
import socket
import subprocess
import sys
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_gateway", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.mod = load()
        self.mod.openclaw_cli_version = lambda: None
        self._port = os.environ.get("OPENCLAW_GATEWAY_PORT")

    def tearDown(self):
        if self._port is None:
            os.environ.pop("OPENCLAW_GATEWAY_PORT", None)
        else:
            os.environ["OPENCLAW_GATEWAY_PORT"] = self._port

    def test_refused_connection_is_down_on_the_default_port(self):
        os.environ.pop("OPENCLAW_GATEWAY_PORT", None)
        self.mod.socket.create_connection = lambda addr, timeout=0.8: (_ for _ in ()).throw(OSError("refused"))
        payload = self.mod.probe_gateway()
        self.assertEqual(payload["host"], "127.0.0.1")
        self.assertEqual(payload["port"], 18789)
        self.assertIs(payload["up"], False)
        self.assertIsNone(payload["latencyMs"])
        self.assertIsInstance(payload["checkedAt"], int)
        self.assertNotIn("version", payload)

    def test_an_open_port_is_up_and_includes_a_version(self):
        os.environ["OPENCLAW_GATEWAY_PORT"] = "19001"
        self.mod.openclaw_cli_version = lambda: "OpenClaw 9"

        class Sock:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        seen = {}

        def connect(addr, timeout=0.8):
            seen["addr"] = addr
            seen["timeout"] = timeout
            return Sock()

        self.mod.socket.create_connection = connect
        payload = self.mod.probe_gateway()
        self.assertEqual(seen["addr"], ("127.0.0.1", 19001))
        self.assertEqual(payload["up"], True)
        self.assertEqual(payload["port"], 19001)
        self.assertEqual(payload["version"], "OpenClaw 9")
        self.assertIsInstance(payload["latencyMs"], int)

    def test_invalid_port_falls_back_to_18789(self):
        os.environ["OPENCLAW_GATEWAY_PORT"] = "0"
        self.assertEqual(self.mod.gateway_listen_port(), 18789)
        os.environ["OPENCLAW_GATEWAY_PORT"] = "nope"
        self.assertEqual(self.mod.gateway_listen_port(), 18789)


class PostTest(unittest.TestCase):
    def test_gateway_snapshot_uses_the_ingest_header(self):
        mod = load()
        seen = {}

        class Resp:
            status = 202

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=15):
            seen["header"] = req.get_header("X-ingest-token")
            seen["body"] = json.loads(req.data.decode())
            return Resp()

        original = mod.urllib.request.urlopen
        mod.urllib.request.urlopen = urlopen
        try:
            ok = mod.post(
                "http://127.0.0.1:3000",
                "super-secret",
                "gateway.snapshot",
                {"up": True, "host": "127.0.0.1", "port": 18789, "checkedAt": 1},
            )
        finally:
            mod.urllib.request.urlopen = original
        self.assertTrue(ok)
        self.assertEqual(seen["header"], "super-secret")
        self.assertEqual(seen["body"]["type"], "gateway.snapshot")
        self.assertNotIn("super-secret", json.dumps(seen["body"]))

    def test_dry_run_with_no_sources_prints_only_the_gateway_check(self):
        env = os.environ.copy()
        env["OPENCLAW_GATEWAY_PORT"] = "9"
        env.pop("MC_BRIDGE_REGISTER", None)
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        self.assertEqual([event.get("type") for event in events], ["gateway.snapshot"])
        payload = events[0]["payload"]
        self.assertEqual(payload["host"], "127.0.0.1")
        self.assertEqual(payload["port"], 9)
        self.assertIn(payload["up"], (True, False))
        self.assertIsInstance(payload["checkedAt"], int)
        self.assertNotIn("INGEST_TOKEN", proc.stdout)


class LiveProbeTest(unittest.TestCase):
    def test_a_local_listener_is_up(self):
        mod = load()
        mod.openclaw_cli_version = lambda: None
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        previous = os.environ.get("OPENCLAW_GATEWAY_PORT")
        os.environ["OPENCLAW_GATEWAY_PORT"] = str(port)
        try:
            payload = mod.probe_gateway()
        finally:
            server.close()
            if previous is None:
                os.environ.pop("OPENCLAW_GATEWAY_PORT", None)
            else:
                os.environ["OPENCLAW_GATEWAY_PORT"] = previous
        self.assertTrue(payload["up"])
        self.assertEqual(payload["port"], port)
        self.assertEqual(payload["host"], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
