"""Run REST calls: ticketId when OpenClaw knows it, and the new status codes."""
import importlib.util
import io
import json
import sys
import tempfile
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

    def _http_error(self, req, status, payload):
        return urllib.error.HTTPError(
            req.full_url,
            status,
            "error",
            hdrs=None,
            fp=io.BytesIO(json.dumps(payload).encode()),
        )

    def test_unknown_ticket_is_retried_once_and_then_fails(self):
        calls = []

        def urlopen(req, timeout=15):
            body = json.loads(req.data.decode())
            calls.append(body)
            self.assertNotIn(b"super-secret", req.data)
            raise self._http_error(req, 404, {"message": "ticketId not found", "statusCode": 404})

        state = {"j1": {"runId": None}}
        original = self.mod.urllib.request.urlopen
        stderr = io.StringIO()
        old_err = sys.stderr
        sys.stderr = stderr
        self.mod.urllib.request.urlopen = urlopen
        try:
            failed = self.mod.apply_run_calls(
                "http://127.0.0.1:3000",
                "super-secret",
                [{"jobId": "j1", "op": "create", "body": {"name": "Morning Brief", "ticketId": "missing"}}],
                state,
            )
        finally:
            self.mod.urllib.request.urlopen = original
            sys.stderr = old_err
        self.assertEqual(failed, 1)
        self.assertIsNone(state["j1"]["runId"])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["ticketId"], "missing")
        self.assertNotIn("ticketId", calls[1])
        text = stderr.getvalue()
        self.assertIn("warning:", text)
        self.assertIn("Retrying once without ticketId", text)
        self.assertNotIn("super-secret", text)

    def test_a_missing_run_404_is_not_retried_as_a_missing_ticket(self):
        calls = []

        def urlopen(req, timeout=15):
            calls.append(json.loads(req.data.decode()))
            raise self._http_error(req, 404, {"message": "run not found", "statusCode": 404})

        state = {"j1": {"runId": "run-missing"}}
        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = urlopen
        try:
            failed = self.mod.apply_run_calls(
                "http://127.0.0.1:3000",
                "tok",
                [{
                    "jobId": "j1",
                    "op": "patch",
                    "runId": "run-missing",
                    "body": {"status": "done", "progress": 100, "ticketId": "t1"},
                }],
                state,
            )
        finally:
            self.mod.urllib.request.urlopen = original
        self.assertEqual(failed, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["ticketId"], "t1")

    def test_missing_openclaw_ticket_records_the_run_and_the_job_completes(self):
        """OpenClaw has a ticket Mission Control does not. The run is stored
        with no ticket, a warning is logged, and the job reaches done."""
        seen = []

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
            body = json.loads(req.data.decode())
            self.assertEqual(req.get_header("X-ingest-token"), "super-secret")
            self.assertNotIn(b"super-secret", req.data)
            seen.append((req.get_method(), body))
            if "ticketId" in body:
                raise self._http_error(req, 404, {"message": "ticketId not found", "statusCode": 404})
            if req.get_method() == "POST":
                return Resp(201, {"run": {"id": "run-kept", "ticketId": None, "status": "queued"}, "ts": 1})
            return Resp(200, {
                "run": {"id": "run-kept", "status": body.get("status"), "ticketId": None},
                "ts": 2,
            })

        stderr = io.StringIO()
        old_err = sys.stderr
        sys.stderr = stderr
        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = urlopen
        try:
            state = {"j1": {"running": False, "lastRunAtMs": None, "runId": None}}
            _events, calls = self.mod.cron_run_plan(
                [job("j1", "Morning Brief", running=True, ticket_id="missing-ticket")],
                state,
            )
            failed = self.mod.apply_run_calls("http://127.0.0.1:3000", "super-secret", calls, state)
            self.assertEqual(failed, 0)
            self.assertEqual(state["j1"]["runId"], "run-kept")
            self.assertTrue(state["j1"]["running"])

            _events, calls = self.mod.cron_run_plan(
                [job("j1", "Morning Brief", running=False, last_at=50, status="ok", ticket_id="missing-ticket")],
                state,
            )
            failed = self.mod.apply_run_calls("http://127.0.0.1:3000", "super-secret", calls, state)
        finally:
            self.mod.urllib.request.urlopen = original
            sys.stderr = old_err

        self.assertEqual(failed, 0)
        self.assertFalse(state["j1"]["running"])
        self.assertEqual(state["j1"]["runId"], "run-kept")
        posts = [body for method, body in seen if method == "POST" and "ticketId" not in body]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["name"], "Morning Brief")
        done = [body for method, body in seen if method == "PATCH" and body.get("status") == "done" and "ticketId" not in body]
        self.assertEqual(len(done), 1)
        self.assertEqual(done[0]["progress"], 100)
        running = [body for method, body in seen if method == "PATCH" and body.get("status") == "running" and "ticketId" not in body]
        self.assertEqual(len(running), 1)
        text = stderr.getvalue()
        self.assertIn("warning:", text)
        self.assertIn("Retrying once without ticketId", text)
        self.assertNotIn("super-secret", text)

    def test_clip_counts_emoji_as_one_character(self):
        body = self.mod._run_create_body("😀" * 201, "🤖" * 101, None)
        self.assertEqual(len(body["name"]), 200)
        self.assertEqual(len(body["agent"]), 100)
        self.assertEqual(body["name"], "😀" * 200)
        self.assertEqual(body["agent"], "🤖" * 100)

    def _sync_runs(self, state_file, rows, urlopen):
        raw = json.loads(state_file.read_text()) if state_file.is_file() else {}
        state = raw if isinstance(raw, dict) else {}
        prior = {k: dict(v) for k, v in state.items() if isinstance(v, dict)}
        _events, calls = self.mod.cron_run_plan(rows, state)
        failed_jobs = set()
        original = self.mod.urllib.request.urlopen
        self.mod.urllib.request.urlopen = urlopen
        try:
            failed = self.mod.apply_run_calls(
                "http://127.0.0.1:3000",
                "super-secret",
                calls,
                state,
                failed_jobs,
            )
        finally:
            self.mod.urllib.request.urlopen = original
        self.mod.keep_successful_run_state(prior, state, failed_jobs)
        self.mod.persist_run_state(state_file, state, 0)
        return failed, json.loads(state_file.read_text())

    def _cron(self, jid, name, agent, running=False, last_at=None):
        row = {
            "id": jid,
            "name": name,
            "agentId": agent,
            "status": "running" if running else "ok",
            "state": {},
        }
        if running:
            row["state"]["runningAtMs"] = 10
        if last_at is not None:
            row["state"]["lastRunAtMs"] = last_at
            row["state"]["lastRunStatus"] = "ok"
        return row

    def test_long_job_beside_a_healthy_one_across_two_syncs(self):
        """A 250 character name and a 120 character agent are clipped.
        The healthy job is not duplicated, and neither run stays running."""
        store = {}
        posts = []

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
            body = json.loads(req.data.decode())
            self.assertEqual(req.get_header("X-ingest-token"), "super-secret")
            self.assertNotIn(b"super-secret", req.data)
            if req.get_method() == "POST":
                posts.append(body)
                if len(body.get("name", "")) > 200 or len(body.get("agent", "")) > 100:
                    raise self._http_error(req, 400, {
                        "message": "name must be 200 characters or fewer",
                        "statusCode": 400,
                    })
                rid = "run-%d" % (len(store) + 1)
                store[rid] = {
                    "id": rid,
                    "name": body["name"],
                    "agent": body.get("agent"),
                    "status": "queued",
                    "progress": 0,
                }
                return Resp(201, {"run": dict(store[rid]), "ts": 1})
            rid = req.full_url.rstrip("/").rsplit("/", 1)[-1]
            row = dict(store[rid])
            if "status" in body:
                row["status"] = body["status"]
            if "progress" in body:
                row["progress"] = body["progress"]
            store[rid] = row
            return Resp(200, {"run": row, "ts": 2})

        long_name = "L" * 250
        long_agent = "A" * 120
        with tempfile.TemporaryDirectory() as tmp:
            state_file = Path(tmp) / "last-run.json"
            state_file.write_text(json.dumps({
                "j-ok": {"running": False, "lastRunAtMs": None, "runId": None},
                "j-long": {"running": False, "lastRunAtMs": None, "runId": None},
            }))
            failed, saved = self._sync_runs(state_file, [
                self._cron("j-ok", "Morning Brief", "Forge", running=True),
                self._cron("j-long", long_name, long_agent, running=True),
            ], urlopen)
            self.assertEqual(failed, 0)
            self.assertTrue(saved["j-ok"]["runId"])
            self.assertTrue(saved["j-long"]["runId"])
            self.assertNotEqual(saved["j-ok"]["runId"], saved["j-long"]["runId"])

            failed, saved = self._sync_runs(state_file, [
                self._cron("j-ok", "Morning Brief", "Forge", last_at=1_700_000_000_000),
                self._cron("j-long", long_name, long_agent, last_at=1_700_000_000_000),
            ], urlopen)
            self.assertEqual(failed, 0)
            self.assertFalse(saved["j-ok"]["running"])
            self.assertFalse(saved["j-long"]["running"])

        self.assertEqual(len(posts), 2)
        clipped = next(body for body in posts if body.get("agent") == "A" * 100)
        healthy = next(body for body in posts if body.get("agent") == "Forge")
        self.assertEqual(clipped["name"], "L" * 200)
        self.assertEqual(len(clipped["name"]), 200)
        self.assertEqual(healthy["name"], "Morning Brief")
        self.assertEqual(len(store), 2)
        self.assertTrue(all(row["status"] == "done" and row["progress"] == 100 for row in store.values()))
        self.assertFalse(any(row["status"] == "running" for row in store.values()))

    def test_one_failed_run_still_saves_the_healthy_job(self):
        store = {}
        posts = []

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
            body = json.loads(req.data.decode())
            if req.get_method() == "POST" and body.get("name") == "Bad":
                posts.append(body)
                raise self._http_error(req, 500, {"message": "nope", "statusCode": 500})
            if req.get_method() == "POST":
                posts.append(body)
                rid = "run-ok"
                store[rid] = {"id": rid, "name": body["name"], "status": "queued", "progress": 0}
                return Resp(201, {"run": dict(store[rid]), "ts": 1})
            rid = req.full_url.rstrip("/").rsplit("/", 1)[-1]
            row = dict(store[rid])
            row["status"] = body.get("status", row["status"])
            row["progress"] = body.get("progress", row["progress"])
            store[rid] = row
            return Resp(200, {"run": row, "ts": 2})

        with tempfile.TemporaryDirectory() as tmp:
            state_file = Path(tmp) / "last-run.json"
            state_file.write_text(json.dumps({
                "j-ok": {"running": False, "lastRunAtMs": None, "runId": None},
                "j-bad": {"running": False, "lastRunAtMs": None, "runId": None},
            }))
            failed, saved = self._sync_runs(state_file, [
                self._cron("j-ok", "Morning Brief", "Forge", running=True),
                self._cron("j-bad", "Bad", "Forge", running=True),
            ], urlopen)
            self.assertEqual(failed, 1)
            self.assertEqual(saved["j-ok"]["runId"], "run-ok")
            self.assertTrue(saved["j-ok"]["running"])
            self.assertFalse(saved["j-bad"]["running"])
            self.assertIsNone(saved["j-bad"]["runId"])

            failed, saved = self._sync_runs(state_file, [
                self._cron("j-ok", "Morning Brief", "Forge", last_at=1_700_000_000_000),
                self._cron("j-bad", "Bad", "Forge", running=True),
            ], urlopen)
            self.assertEqual(failed, 1)
            self.assertFalse(saved["j-ok"]["running"])
            self.assertEqual(saved["j-ok"]["runId"], "run-ok")
            self.assertFalse(saved["j-bad"]["running"])

        self.assertEqual([body["name"] for body in posts if body["name"] == "Morning Brief"], ["Morning Brief"])
        self.assertEqual(store["run-ok"]["status"], "done")
        self.assertFalse(any(row["status"] == "running" for row in store.values()))


if __name__ == "__main__":
    unittest.main()
