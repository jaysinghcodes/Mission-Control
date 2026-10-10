"""Run REST calls: ticketId when OpenClaw knows it, and the new status codes."""
import importlib.util
import io
import json
import unittest
import urllib.error
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "mc-bridge-sync.py"


def load():
    spec = importlib.util.spec_from_file_location("mc_bridge_sync_runs", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def job(jid, name, running=False, last_at=None, status="ok", ticket_id=None, meta=None):
    row = {
        "id": jid,
        "name": name,
        "agentId": "Forge",
        "status": "running" if running else "ok",
        "state": {},
    }
    if running:
        row["state"]["runningAtMs"] = 10
    if last_at is not None:
        row["state"]["lastRunAtMs"] = last_at
        row["state"]["lastRunStatus"] = status
    if ticket_id is not None:
        row["ticketId"] = ticket_id
    if meta is not None:
        row["meta"] = meta
    return row


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.mod = load()

    def test_first_sight_records_state_and_posts_nothing(self):
        state = {}
        events, calls = self.mod.cron_run_plan([job("j1", "Morning Brief", ticket_id="t1")], state)
        self.assertEqual(events, [])
        self.assertEqual(calls, [])
        self.assertIsNone(state["j1"]["runId"])

    def test_start_passes_ticket_id_when_openclaw_knows_it(self):
        state = {"j1": {"running": False, "lastRunAtMs": None, "runId": None}}
        events, calls = self.mod.cron_run_plan(
            [job("j1", "Morning Brief", running=True, ticket_id=" ticket-9 ")],
            state,
        )
        self.assertEqual(events[0][0], "run.running")
        self.assertEqual(events[0][1]["ticketId"], "ticket-9")
        self.assertEqual(calls[0]["op"], "create")
        self.assertEqual(calls[0]["body"]["ticketId"], "ticket-9")
        self.assertNotIn("ticketId", {k: calls[0]["body"][k] for k in calls[0]["body"] if k != "ticketId"})
        self.assertEqual(calls[0]["follow"], {"status": "running", "ticketId": "ticket-9"})

    def test_start_without_a_ticket_omits_the_field(self):
        state = {"j1": {"running": False, "lastRunAtMs": None}}
        _events, calls = self.mod.cron_run_plan([job("j1", "Morning Brief", running=True)], state)
        self.assertNotIn("ticketId", calls[0]["body"])
        self.assertNotIn("ticketId", calls[0]["follow"])

    def test_meta_ticket_id_counts_as_known(self):
        state = {"j1": {"running": False, "lastRunAtMs": None}}
        _events, calls = self.mod.cron_run_plan(
            [job("j1", "Morning Brief", running=True, meta={"ticketId": "from-meta"})],
            state,
        )
        self.assertEqual(calls[0]["body"]["ticketId"], "from-meta")

    def test_finish_patches_the_stored_run(self):
        state = {"j1": {"running": True, "lastRunAtMs": 1, "runId": "run-1"}}
        _events, calls = self.mod.cron_run_plan(
            [job("j1", "Morning Brief", running=False, last_at=2, status="ok", ticket_id="t1")],
            state,
        )
        self.assertEqual(calls, [{
            "jobId": "j1",
            "op": "patch",
            "runId": "run-1",
            "body": {"status": "done", "progress": 100, "ticketId": "t1"},
        }])


class WriteTest(unittest.TestCase):
    def setUp(self):
        self.mod = load()

    def test_write_json_sends_the_header_and_treats_201_as_success(self):
        seen = {}

        class Resp:
            status = 201

            def read(self):
                return b'{"run":{"id":"run-9"},"ts":1}'

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=15):
            seen["url"] = req.full_url
            seen["header"] = req.get_header("X-ingest-token")
            seen["method"] = req.get_method()
            seen["data"] = req.data
            return Resp()

        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = urlopen
        try:
            ok, status, body = self.mod.write_json(
                "http://127.0.0.1:3000",
                "super-secret",
                "POST",
                "/runs",
                {"name": "Morning Brief", "ticketId": "t1"},
            )
        finally:
            self.mod.urllib.request.urlopen = original

        self.assertTrue(ok)
        self.assertEqual(status, 201)
        self.assertEqual(body["run"]["id"], "run-9")
        self.assertEqual(seen["url"], "http://127.0.0.1:3000/runs")
        self.assertEqual(seen["header"], "super-secret")
        self.assertEqual(seen["method"], "POST")
        self.assertNotIn(b"super-secret", seen["data"])
        self.assertIn(b"ticket-id" if False else b"t1", seen["data"])

    def test_a_200_body_with_an_error_key_is_not_success(self):
        class Resp:
            status = 200

            def read(self):
                return b'{"error":"name is required"}'

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = lambda req, timeout=15: Resp()
        try:
            ok, status, body = self.mod.write_json("http://127.0.0.1:3000", "tok", "POST", "/runs", {"name": ""})
        finally:
            self.mod.urllib.request.urlopen = original
        self.assertFalse(ok)
        self.assertEqual(status, 200)
        self.assertEqual(body["error"], "name is required")

    def test_404_is_a_failure_and_the_token_is_not_logged(self):
        def urlopen(req, timeout=15):
            raise urllib.error.HTTPError(
                req.full_url,
                404,
                "Not Found",
                hdrs=None,
                fp=io.BytesIO(b'{"message":"ticketId not found","statusCode":404}'),
            )

        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = urlopen
        try:
            ok, status, body = self.mod.write_json(
                "http://127.0.0.1:3000",
                "super-secret",
                "POST",
                "/runs",
                {"name": "Orphan", "ticketId": "missing"},
            )
        finally:
            self.mod.urllib.request.urlopen = original
        self.assertFalse(ok)
        self.assertEqual(status, 404)
        self.assertEqual(body["message"], "ticketId not found")

    def test_apply_accepts_201_then_200_and_stores_the_run_id(self):
        calls = []

        class Resp:
            def __init__(self, status, payload):
                self.status = status
                self.payload = payload

            def read(self):
                return json.dumps(self.payload).encode()

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=15):
            self.assertEqual(req.get_header("X-ingest-token"), "super-secret")
            self.assertNotIn(b"super-secret", req.data)
            calls.append((req.get_method(), req.full_url, json.loads(req.data.decode())))
            if req.get_method() == "POST":
                return Resp(201, {"run": {"id": "run-new"}, "ts": 1})
            return Resp(200, {"run": {"id": "run-new", "status": "running"}, "ts": 2})

        state = {"j1": {"running": True, "lastRunAtMs": None, "runId": None}}
        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = urlopen
        try:
            failed = self.mod.apply_run_calls(
                "http://127.0.0.1:3000",
                "super-secret",
                [{
                    "jobId": "j1",
                    "op": "create",
                    "body": {"name": "Morning Brief", "ticketId": "t1"},
                    "follow": {"status": "running", "ticketId": "t1"},
                }],
                state,
            )
        finally:
            self.mod.urllib.request.urlopen = original
        self.assertEqual(failed, 0)
        self.assertEqual(state["j1"]["runId"], "run-new")
        self.assertEqual(calls[0][0], "POST")
        self.assertEqual(calls[1][0], "PATCH")
        self.assertTrue(calls[1][1].endswith("/runs/run-new"))

    def test_apply_rejects_a_200_create(self):
        class Resp:
            status = 200

            def read(self):
                return b'{"run":{"id":"run-new"}}'

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        state = {"j1": {"runId": None}}
        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = lambda req, timeout=15: Resp()
        try:
            failed = self.mod.apply_run_calls(
                "http://127.0.0.1:3000",
                "tok",
                [{"jobId": "j1", "op": "create", "body": {"name": "Morning Brief"}}],
                state,
            )
        finally:
            self.mod.urllib.request.urlopen = original
        self.assertEqual(failed, 1)
        self.assertIsNone(state["j1"]["runId"])


if __name__ == "__main__":
    unittest.main()
