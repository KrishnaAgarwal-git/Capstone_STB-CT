"""
demo_server.py -- a tiny, dependency-free HTTP server exposing the
orchestrator (orchestrator.py) to the demo UI (../demo_ui/index.html).

Run with:  python3 demo_server.py
Then open: http://localhost:8420  (serves the UI directly, no separate
           static file server needed)

This file exists ONLY to give the demo UI something normal to fetch()
against -- it is not a production API design. See
`../04-api-design.md` (already in this project) for what the real API
surface should look like once you have a real backend framework and
database. This file's job is narrower: prove the pipeline end-to-end with
zero setup.

Uses only the Python standard library (http.server) -- no pip install
required to run the demo.
"""

from __future__ import annotations

import json
import os
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from recommendation_engine import FeedbackType, Category
from orchestrator import InMemoryUserStore, build_demo_client, seed_demo_activities

STORE = InMemoryUserStore()
CARBON_CLIENT = build_demo_client()  # <-- the one line that changes for a real calculator;
                                      #     see orchestrator.py's module docstring

DEMO_UI_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo_ui")

# So the demo has *something* real to look at immediately on first load,
# rather than an empty state before the person clicks anything.
_DEFAULT_DEMO_USERS = {
    "demo_cold_start": 3,
    "demo_progressive": 20,
    "demo_mature": 45,
}
for _uid, _age in _DEFAULT_DEMO_USERS.items():
    STORE.ensure_user(_uid, account_age_days=_age)
    for _activity in seed_demo_activities(_uid, account_age_days=_age):
        STORE.add_activity(_uid, _activity)


def _json_bytes(payload) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    # keep the default console noise down; comment out to debug
    def log_message(self, format, *args):
        pass

    def _send(self, status: int, payload):
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path: str):
        full_path = os.path.normpath(os.path.join(DEMO_UI_DIR, path.lstrip("/")))
        if not full_path.startswith(DEMO_UI_DIR):
            self.send_error(403)
            return
        if not os.path.isfile(full_path):
            self.send_error(404)
            return
        content_type = "text/html"
        if full_path.endswith(".js"):
            content_type = "application/javascript"
        elif full_path.endswith(".css"):
            content_type = "text/css"
        with open(full_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, {})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self._send_static("index.html")
            return
        if path.startswith("/static/"):
            self._send_static(path[len("/static/"):])
            return

        if path == "/api/health":
            self._send(200, {"status": "ok"})
            return

        if path == "/api/users":
            self._send(200, {"users": list(_DEFAULT_DEMO_USERS.keys())})
            return

        if path.startswith("/api/users/") and path.endswith("/recommendations"):
            user_id = path.split("/")[3]
            if user_id not in STORE._created_at:
                self._send(404, {"error": f"unknown user_id '{user_id}'"})
                return
            try:
                notifications = STORE.get_recommendations(user_id, CARBON_CLIENT)
            except Exception as e:  # noqa: BLE001 -- demo server, want the message surfaced not swallowed
                self._send(500, {"error": str(e)})
                return
            self._send(200, {
                "user_id": user_id,
                "account_age_days": STORE.account_age_days(user_id),
                "activity_count": len(STORE.get_activities(user_id)),
                "recommendations": [n.to_dict() for n in notifications],
            })
            return

        if path.startswith("/api/users/") and path.endswith("/baseline"):
            user_id = path.split("/")[3]
            if user_id not in STORE._created_at:
                self._send(404, {"error": f"unknown user_id '{user_id}'"})
                return
            from orchestrator import aggregate_user_carbon_baseline
            baseline = aggregate_user_carbon_baseline(
                STORE.get_activities(user_id), CARBON_CLIENT,
            )
            self._send(200, {cat.value: kg for cat, kg in baseline.items()})
            return

        self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid JSON body"})
            return

        if path == "/api/users/new":
            account_age_days = int(body.get("account_age_days", 0))
            user_id = body.get("user_id") or f"demo_user_{len(STORE._created_at)}"
            STORE.ensure_user(user_id, account_age_days=account_age_days)
            if body.get("seed_activities", True):
                for activity in seed_demo_activities(user_id, account_age_days=account_age_days):
                    STORE.add_activity(user_id, activity)
            self._send(200, {"user_id": user_id, "account_age_days": account_age_days})
            return

        if path.startswith("/api/users/") and path.endswith("/feedback"):
            user_id = path.split("/")[3]
            if user_id not in STORE._created_at:
                self._send(404, {"error": f"unknown user_id '{user_id}'"})
                return
            notification_id = body.get("recommendation_id")
            event_type_raw = body.get("event_type")
            if not notification_id or not event_type_raw:
                self._send(400, {"error": "recommendation_id and event_type are required"})
                return
            try:
                event_type = FeedbackType(event_type_raw)
            except ValueError:
                self._send(400, {"error": f"invalid event_type '{event_type_raw}', "
                                          f"expected one of {[e.value for e in FeedbackType]}"})
                return
            try:
                STORE.record_feedback(user_id, notification_id, event_type)
            except KeyError as e:
                self._send(404, {"error": str(e)})
                return
            ctx = STORE.get_context(user_id)
            self._send(200, {
                "status": "recorded",
                "category_acceptance_rate": {
                    cat.value: round(rate, 4) for cat, rate in ctx.category_acceptance_rate.items()
                },
                "disabled_categories": [c.value for c in ctx.disabled_categories],
            })
            return

        self.send_error(404)


def main():
    port = int(os.environ.get("PORT", 8420))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Demo server running at http://localhost:{port}")
    print(f"Serving UI from: {DEMO_UI_DIR}")
    print("Carbon Calculator: MockCarbonCalculationClient (fake data, clearly labelled MOCK_DATA)")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")


if __name__ == "__main__":
    main()
