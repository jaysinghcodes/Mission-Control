"""A successful sync records a unix timestamp. A dry run does not."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_stamp", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class StampTest(unittest.TestCase):
    def test_record_sync_writes_unix_seconds(self):
        mod = load()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "last-sync"
            previous = os.environ.get("MC_BRIDGE_STAMP_FILE")
            os.environ["MC_BRIDGE_STAMP_FILE"] = str(path)
            try:
                mod.record_sync()
            finally:
                if previous is None:
                    os.environ.pop("MC_BRIDGE_STAMP_FILE", None)
                else:
                    os.environ["MC_BRIDGE_STAMP_FILE"] = previous
            text = path.read_text(encoding="utf-8").strip()
            self.assertRegex(text, r"^[0-9]+$")
            self.assertLess(abs(int(text) - int(time.time())), 5)

    def test_dry_run_does_not_write_a_stamp_and_a_real_run_does(self):
        with tempfile.TemporaryDirectory() as tmp:
            stamp = Path(tmp) / "last-sync"
            env = os.environ.copy()
            env["MC_BRIDGE_STAMP_FILE"] = str(stamp)
            env["INGEST_TOKEN"] = ""
            dry = subprocess.run(
                [sys.executable, str(BRIDGE), "--dry-run"],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(dry.returncode, 0, dry.stderr)
            self.assertFalse(stamp.exists())

            env["INGEST_TOKEN"] = "stamp-test-token"
            bin_dir = Path(tmp) / "bin"
            bin_dir.mkdir()
            stub = bin_dir / "openclaw"
            stub.write_text("#!/bin/sh\necho 'stub openclaw' >&2\nexit 1\n", encoding="utf-8")
            stub.chmod(0o755)
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"

            class Handler(BaseHTTPRequestHandler):
                def do_POST(self):
                    length = int(self.headers.get("Content-Length", "0"))
                    self.server.bodies.append(self.rfile.read(length))
                    self.server.token = self.headers.get("x-ingest-token")
                    self.send_response(202)
                    self.end_headers()

                def log_message(self, fmt, *args):
                    return

            httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            httpd.bodies = []
            httpd.token = None
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            env["MC_API_URL"] = f"http://127.0.0.1:{httpd.server_address[1]}"
            try:
                real = subprocess.run(
                    [sys.executable, str(BRIDGE)],
                    env=env,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(real.returncode, 0, real.stderr)
                self.assertFalse(stamp.exists())
                self.assertTrue(httpd.bodies)
                posted = json.loads(httpd.bodies[-1].decode())
                self.assertEqual(posted["type"], "gateway.snapshot")
                self.assertEqual(httpd.token, "stamp-test-token")

                empty = Path(tmp) / "empty-openclaw"
                empty.mkdir()
                missed = subprocess.run(
                    [sys.executable, str(BRIDGE), "--from-dir", str(empty)],
                    env=env,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(missed.returncode, 0, missed.stderr)
                self.assertFalse(stamp.exists())
            finally:
                httpd.shutdown()


if __name__ == "__main__":
    unittest.main()
