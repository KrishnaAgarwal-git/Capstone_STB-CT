"""
engine_server.py — production-shaped HTTP wrapper around the recommendation
engine, distinct from demo_server.py in one crucial way: this file takes
REAL activity data in the request body (sent by the Node backend, sourced
from real logged CarbonActivity documents in MongoDB) and calls the REAL
Carbon Calculator over HTTP. There is no seeded/synthetic data anywhere in
this file — seed_demo_activities() from orchestrator.py is never imported.

Stdlib only for the HTTP layer itself — no `pip install requests` needed
(NodeCarbonCalculationClient below uses urllib.request instead). `numpy` IS
still required, because `orchestrator.py` imports `linucb.py` at module load
time regardless of whether a LinUCB model is actually supplied at runtime.
If numpy isn't already installed: `pip install numpy --break-system-packages`.

STATEFUL, not a fresh calculation per request. This process holds ONE
`InMemoryUserStore` (see orchestrator.py) alive in memory for its entire
lifetime, which is what makes the feedback loop real rather than
decorative: accepting or dismissing a recommendation calls
`store.record_feedback()`, which updates a LinUCB arm weight shared across
every user, and adjusts that user's UserContext (acceptance rate,
dismissal streak, disabled categories). The NEXT call to
`store.get_recommendations()` for any user reflects that update. This
state lives only in this process's memory — restarting engine_server.py
resets it. That's an explicit, stated limitation, not an oversight: a real
production deployment would back this with the Postgres schema already
sketched in 03-database-schema.sql instead of a Python dict.

Run:
    python3 engine_server.py
    (reads NODE_BACKEND_URL and ENGINE_SHARED_SECRET from engine/.env)

Endpoints:
    POST /recommendations
        Body: { "user_id", "account_age_days", "region_code", "activities": [...] }
        Runs the real pipeline for this user against their current (Node-supplied)
        activity history and returns ranked recommendations with the full field
        set the engine computes - id, title, body, category, saved_kg_co2e,
        percent_reduction, difficulty, tradeoff_note, confidence,
        weekly_kg_projection, monthly_kg_projection.

    POST /recommendations/feedback
        Body: { "user_id", "notification_id", "event_type" }
        event_type is one of: accepted | dismissed | ignored |
        partially_completed | behaviour_confirmed | behaviour_unchanged
        (see recommendation_engine.FeedbackType). notification_id must be
        an id returned from that user's MOST RECENT /recommendations call -
        the store only remembers the latest round per user, matching how
        the engine's own class docstring describes this working.
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def load_dotenv(path=".env"):
    """
    Tiny stdlib .env loader - no pip install needed. Reads KEY=VALUE lines
    from the given file (relative to this script's own folder, so it works
    no matter which directory you launch python from) and sets them into
    os.environ, WITHOUT overwriting a variable if it was already set some
    other way (e.g. via `set`/`export`/`setx`). This means you can just put
    values in engine/.env and run `python engine_server.py` directly - no
    `export $(cat .env | xargs)` on Mac/Linux, no `set` on Windows cmd, no
    Invoke-RestMethod gymnastics needed.
    """
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_dotenv()

from recommendation_engine import (
    Activity,
    Category,
    CarbonEstimate,
    EmissionFactor,
    FeedbackType,
)
from orchestrator import InMemoryUserStore

NODE_BACKEND_URL = os.environ.get("NODE_BACKEND_URL", "http://localhost:5000").rstrip("/")
ENGINE_SHARED_SECRET = os.environ.get("ENGINE_SHARED_SECRET", "")
PORT = int(os.environ.get("ENGINE_PORT", "8421"))

if not ENGINE_SHARED_SECRET:
    print(
        "[engine_server] WARNING: ENGINE_SHARED_SECRET is empty. "
        "Check that engine/.env exists and has that line set - "
        "calls to the Node backend will be rejected without it.",
        file=sys.stderr,
    )

CATEGORY_MAP = {
    "transportation": Category.TRANSPORT,
    "transport": Category.TRANSPORT,
    "electricity": Category.ELECTRICITY,
    "food": Category.FOOD,
    "consumption": Category.SHOPPING,
    "shopping": Category.SHOPPING,
    "water": Category.WATER,
    "waste": Category.WASTE,
    "lifestyle": Category.LIFESTYLE,
}

VALID_FEEDBACK_TYPES = {t.value for t in FeedbackType}

# ONE store, created once, alive for the life of this process. This is what
# makes record_feedback() meaningfully affect future get_recommendations()
# calls - see the module docstring above.
STORE = InMemoryUserStore()


class NodeCarbonCalculationClient:
    """Same protocol as recommendation_engine.HttpCarbonCalculationClient,
    implemented with urllib (stdlib) instead of requests, so this service
    needs no extra pip install. Calls the REAL Node backend's
    POST /api/v1/recommendations/preview — the endpoint backed by
    Backend/src/data/scientificEmissionFactors.js, not mock data."""

    def __init__(self, base_url: str, shared_secret: str = "", timeout_seconds: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.shared_secret = shared_secret
        self.timeout_seconds = timeout_seconds

    def estimate(self, activity_key: str, quantity: float, unit: str,
                 region_code: str = "GLOBAL") -> CarbonEstimate:
        body = json.dumps({
            "baseline_activity": activity_key,
            "baseline_quantity": quantity,
            "unit": unit,
            "region_code": region_code,
            "candidate_alternatives": [],
        }).encode("utf-8")

        headers = {"Content-Type": "application/json"}
        if self.shared_secret:
            headers["X-Engine-Secret"] = self.shared_secret

        req = urllib.request.Request(
            f"{self.base_url}/api/v1/recommendations/preview",
            data=body, headers=headers, method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        factor_info = payload.get("emission_factor", {})
        factor = EmissionFactor(
            factor_key=activity_key,
            unit=factor_info.get("unit", "kg_co2e_per_kg"),
            source=factor_info.get("source", "unknown"),
            version=factor_info.get("version", "unknown"),
            region_code=region_code,
        )
        return CarbonEstimate(
            activity_key=activity_key,
            quantity=quantity,
            unit=unit,
            co2e_kg=payload["baseline_emissions_kg"],
            emission_factor=factor,
            calculation_confidence=payload.get("calculation_confidence", 1.0),
        )


def parse_activities(raw_activities):
    """Real activities only - no seeding. Maps the Node backend's
    domain/subtype vocabulary onto Activity(category, subtype, quantity,
    unit, occurred_at). If a domain doesn't map cleanly, it's skipped rather
    than guessed."""
    activities = []
    for a in raw_activities:
        category = CATEGORY_MAP.get(a.get("category") or a.get("domain"))
        if category is None:
            continue
        try:
            occurred_at = datetime.fromisoformat(a["occurred_at"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        activities.append(Activity(
            user_id=a.get("user_id", "unknown"),
            category=category,
            subtype=a.get("subtype", "unknown"),
            quantity=float(a.get("quantity", 1)),
            unit=a.get("unit", "unit"),
            occurred_at=occurred_at,
        ))
    return activities


def sync_user_activities(user_id: str, account_age_days: int, activities: list):
    """
    Node/MongoDB is the source of truth for WHAT was logged - this store
    should never accumulate its own duplicate copy across repeated calls.
    So on every request we replace this user's activity list with exactly
    what Node just sent, using the store's own public add_activity() method
    for insertion (only the reset step reaches into the store's internal
    dict directly, since InMemoryUserStore has no public "replace" method).

    What DOES persist across calls untouched is everything that represents
    accumulated feedback - UserContext, dismissal streaks, and the shared
    LinUCB model - which is exactly the state the feedback loop needs to
    carry forward.
    """
    STORE.ensure_user(user_id, account_age_days=account_age_days)
    STORE._activities[user_id] = []  # noqa: SLF001 - see docstring above
    for a in activities:
        STORE.add_activity(user_id, a)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "backend": NODE_BACKEND_URL})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/recommendations":
            self._handle_recommendations()
        elif self.path == "/recommendations/feedback":
            self._handle_feedback()
        else:
            self._send_json(404, {"error": "not found"})

    def _handle_recommendations(self):
        try:
            body = self._read_json_body()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid JSON body"})
            return

        user_id = body.get("user_id", "unknown")
        account_age_days = int(body.get("account_age_days", 0))
        region_code = body.get("region_code", "GLOBAL")
        raw_activities = body.get("activities", [])

        activities = parse_activities(raw_activities)
        sync_user_activities(user_id, account_age_days, activities)

        carbon_client = NodeCarbonCalculationClient(NODE_BACKEND_URL, ENGINE_SHARED_SECRET)

        try:
            notifications = STORE.get_recommendations(
                user_id=user_id, carbon_client=carbon_client, region_code=region_code,
            )
        except urllib.error.URLError as e:
            self._send_json(502, {
                "error": "Could not reach the Node carbon calculator",
                "detail": str(e),
                "nodeBackendUrl": NODE_BACKEND_URL,
            })
            return
        except Exception as e:  # pragma: no cover - defensive
            self._send_json(500, {"error": str(e)})
            return

        profile = None
        try:
            from profile_confidence import compute_data_confidence
            profile = compute_data_confidence(user_id, activities, datetime.now())
        except Exception:  # pragma: no cover - profile is supplementary, never fatal
            pass

        result = {
            "source": "linucb_engine",  # distinguishes from the Node fallback rule engine
            "userId": user_id,
            "activityCount": len(activities),
            "profile": {
                "confidenceTier": profile.confidence_tier if profile else "cold",
                "overallConfidence": round(profile.overall_confidence, 3) if profile else 0,
                "activeDays": profile.active_days if profile else 0,
                "categoriesCovered": profile.categories_covered if profile else 0,
            },
            "recommendations": [
                {
                    "recommendationId": n.id,
                    # n.body is already the rendered human-readable explanation
                    # (render_explanation_text) - this is the real trace, not
                    # a placeholder.
                    "title": n.title,
                    "body": n.body,
                    "category": n.category,
                    "savedKgCo2e": round(n.saved_kg_co2e, 3) if n.saved_kg_co2e is not None else None,
                    "percentReduction": round(n.percent_reduction, 1) if n.percent_reduction is not None else None,
                    "difficulty": n.difficulty,
                    "tradeoffNote": n.tradeoff_note,
                    "confidence": round(n.confidence, 3),
                    "weeklyKgProjection": round(n.weekly_kg_projection, 3) if n.weekly_kg_projection is not None else None,
                    "monthlyKgProjection": round(n.monthly_kg_projection, 3) if n.monthly_kg_projection is not None else None,
                }
                for n in notifications
            ],
        }
        self._send_json(200, result)

    def _handle_feedback(self):
        try:
            body = self._read_json_body()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid JSON body"})
            return

        user_id = body.get("user_id")
        notification_id = body.get("notification_id")
        event_type_raw = body.get("event_type")

        if not user_id or not notification_id or not event_type_raw:
            self._send_json(400, {"error": "user_id, notification_id, and event_type are required"})
            return
        if event_type_raw not in VALID_FEEDBACK_TYPES:
            self._send_json(400, {
                "error": f"event_type must be one of {sorted(VALID_FEEDBACK_TYPES)}",
            })
            return

        try:
            STORE.record_feedback(user_id, notification_id, FeedbackType(event_type_raw))
        except KeyError:
            # Most likely cause: the server restarted since this recommendation
            # was shown (state is in-memory only), or the user is looking at a
            # stale list from an earlier /recommendations call. Either way,
            # the honest response is "ask for a fresh list", not a fake success.
            self._send_json(404, {
                "error": "That recommendation is no longer recognised - it may be from "
                         "before a server restart, or an earlier list. Refresh and try again.",
            })
            return
        except Exception as e:  # pragma: no cover - defensive
            self._send_json(500, {"error": str(e)})
            return

        self._send_json(200, {
            "success": True,
            "message": f"Recorded '{event_type_raw}' - this will influence future recommendations.",
        })

    def log_message(self, format, *args):
        sys.stderr.write("[engine_server] " + (format % args) + "\n")


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Recommendation engine server running on http://localhost:{PORT}")
    print(f"  -> calling Node carbon calculator at {NODE_BACKEND_URL}")
    print(f"  -> POST /recommendations with real activity data (no seeding)")
    print(f"  -> POST /recommendations/feedback closes the learning loop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
