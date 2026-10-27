"""Bridge output follows the product copy rule: no em dash, en dash, or arrow (#152)."""
import ast
import re
import subprocess
import sys
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"
DASH = re.compile("[\u2010\u2011\u2012\u2013\u2014\u2015\u2190\u2192\u21d2]")
# Hyphen used as punctuation: a hyphen with a space on each side.
SPACED_HYPHEN = re.compile(r"\s-{1,2}\s")


class CopyTest(unittest.TestCase):
    def test_file_has_no_dash_punctuation(self):
        text = BRIDGE.read_text(encoding="utf-8")
        hits = [f"{n}: {line}" for n, line in enumerate(text.splitlines(), 1) if DASH.search(line)]
        self.assertEqual(hits, [])

    def test_log_strings_have_no_spaced_hyphen(self):
        tree = ast.parse(BRIDGE.read_text(encoding="utf-8"))
        bad = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name not in ("log", "print", "ArgumentParser", "add_argument"):
                continue
            parts = list(node.args) + [kw.value for kw in node.keywords if kw.arg in ("help", "description")]
            for arg in parts:
                for sub in ast.walk(arg):
                    if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                        if DASH.search(sub.value) or SPACED_HYPHEN.search(sub.value):
                            bad.append(f"{sub.lineno}: {sub.value}")
        self.assertEqual(bad, [])

    def test_missing_openclaw_line_reads_cleanly(self):
        env = {"PATH": "/nonexistent", "INGEST_TOKEN": "x" * 48}
        proc = subprocess.run(
            [sys.executable, str(BRIDGE), "--dry-run"],
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
        )
        out = proc.stdout + proc.stderr
        self.assertIsNone(DASH.search(out), out)
        self.assertIn("not found on PATH. Skipping agents list.", out)


if __name__ == "__main__":
    unittest.main()
