# Carbon Engine Integration

This document defines the exact boundary between the Recommendation Engine (this repository) and the external **Carbon Calculation Service** ("Carbon Engine"), which is developed separately and is **not** implemented here.

Status: accurate as of the code in `engine/` at the time this was written. Re-generate this section of understanding from the code, not from memory, if `recommendation_engine.py`'s `CarbonCalculationClient` protocol or its implementations change.

---

## 1. The boundary, stated plainly

The Recommendation Engine **never computes kg CO2e itself**. Every gram of carbon math in this repository happens inside a class that implements the `CarbonCalculationClient` protocol, and every one of those classes exists to produce or fake a call to the real, external Carbon Calculation Service — never to derive an emissions number from a raw factor value locally.

This is stated in `recommendation_engine.py`'s own module docstring and enforced structurally: `RecommendationCandidate.__post_init__` only ever takes the *difference* and *percentage* of two `co2e_kg` numbers that already arrived from a `CarbonCalculationClient.estimate(...)` call. No file in this repository multiplies `quantity * emission_factor` outside of a `CarbonCalculationClient` implementation.

```
generate_candidates() / generate_candidates_from_selections()
        │
        ▼
carbon_client.estimate(activity_key, quantity, unit, region_code)   ← the ONLY entry point
        │
        ▼
CarbonEstimate(activity_key, quantity, unit, co2e_kg, emission_factor, calculation_confidence)
        │
        ▼
RecommendationCandidate.__post_init__ computes saved_kg_co2e = baseline.co2e_kg - recommended.co2e_kg
(a subtraction of two already-computed numbers — not a re-derivation)
```

---

## 2. The contract: `CarbonCalculationClient`

Defined in `engine/recommendation_engine.py` as a `typing.Protocol` — any class satisfying this method signature is a valid Carbon Engine client, whether it's this repo's mock, a test double, or the real production service.

```python
class CarbonCalculationClient(Protocol):
    def estimate(self, activity_key: str, quantity: float, unit: str,
                 region_code: str = "GLOBAL") -> CarbonEstimate:
        ...
```

### Request fields (what the Recommendation Engine sends)

| Field | Type | Meaning |
|---|---|---|
| `activity_key` | `str` | A stable identifier for one specific activity/food/transport-mode/appliance-use, e.g. `"chicken_curry_cooked"`, `"car_solo_commute"`, `"standby_power_overnight"`. Sourced from `RecommendationDefinition.baseline_activity_key` / `recommended_activity_key` (see `knowledge_base.py`) or from a logged `Activity.subtype`. |
| `quantity` | `float` | The amount of that activity, in `unit`'s terms. |
| `unit` | `str` | The unit the quantity is expressed in — `"kg"`, `"km"`, `"kwh"`, `"item"`, and many more (the 104-entry knowledge base uses ~40 distinct unit strings; see `RECOMMENDATION_ENGINE.md` §3). |
| `region_code` | `str`, default `"GLOBAL"` | Where the activity happened, for region-sensitive factors (electric-vehicle emissions depend heavily on local grid mix — see the worked `IN_PUNJAB` / `IN_COAL_HEAVY` example in `orchestrator.py`). |

### Response contract: `CarbonEstimate`

```python
@dataclass(frozen=True)
class CarbonEstimate:
    activity_key: str
    quantity: float
    unit: str
    co2e_kg: float
    emission_factor: EmissionFactor
    calculation_confidence: float = 1.0

@dataclass(frozen=True)
class EmissionFactor:
    factor_key: str
    unit: str                 # e.g. "kg_co2e_per_kg"
    source: str                # e.g. "DEFRA_2024", "MOCK_DATA"
    version: str
    region_code: str = "GLOBAL"
```

`EmissionFactor` is carried through purely as a citation/audit record — the engine never inspects `value` (there isn't one on this side; the value already got multiplied into `co2e_kg` by the Carbon Engine before this object was constructed). It exists so `build_explanation()` (see `recommendation_engine.py` §4) can show a user or auditor exactly which factor, source, and version produced a number.

### Error contract

If the Carbon Engine has no factor for a given `(activity_key, region_code)` pair, the client **must raise `KeyError`**. This is a hard part of the contract — `generate_candidates()` and `generate_candidates_from_selections()` both catch `KeyError` specifically and silently skip that one candidate rather than guessing at a number:

```python
try:
    baseline_estimate = carbon_client.estimate(...)
    recommended_estimate = carbon_client.estimate(...)
except KeyError:
    return None   # candidate dropped, never priced with an invented number
```

Any other exception (network failure, 5xx, timeout) is **not** part of this contract and will propagate up uncaught — `demo_server.py`'s handler catches `Exception` broadly and returns a 500 with the message, but that is demo-server behavior, not part of the client contract itself.

---

## 3. The three implementations

| Class | File | Role |
|---|---|---|
| `HttpCarbonCalculationClient` | `recommendation_engine.py` | **Production.** Calls a real external service over HTTP. This is the class you point at your actual Carbon Engine. |
| `InMemoryCarbonCalculationClient` | `recommendation_engine.py` | **Test double.** A pre-registered `{(activity_key, region_code): (value, source, version, unit)}` lookup table, used by `test_recommendation_engine.py` and the module's own `_demo()`. |
| `MockCarbonCalculationClient` | `orchestrator.py` | **Demo-only.** Fake numbers for `demo_server.py` / the demo UI, clearly labelled so they're never mistaken for real data. |

All three satisfy the identical protocol — nothing downstream (`generate_candidates`, `score_candidate`, `aggregate_user_carbon_baseline`, `build_explanation`) knows or cares which one it's talking to.

### 3.1 `HttpCarbonCalculationClient` — the real integration point

```python
HttpCarbonCalculationClient(base_url="https://your-carbon-calculator.example.com")
```

Makes exactly one call per `estimate()` invocation:

```
POST {base_url}/api/v1/recommendations/preview
Body:
{
  "baseline_activity": "<activity_key>",
  "baseline_quantity": <quantity>,
  "unit": "<unit>",
  "region_code": "<region_code>",
  "candidate_alternatives": []
}

Response 200:
{
  "baseline_emissions_kg": <float>,
  "emission_factor": {
    "unit": "<factor unit string>",
    "source": "<source label>",
    "version": "<version string>"
  },
  "calculation_confidence": <float, 0-1>
}
```

This endpoint name and shape is not invented for this integration doc — it mirrors `04-api-design.md`'s existing `POST /api/v1/recommendations/preview` design (§9), which was already specified for a different purpose (in-app "what if I swapped X for Y" exploration) and happens to be exactly the request/response shape the engine needs internally too — the same design document notes this endpoint is meant to be "reusing the same Carbon Calculation Service used internally by recommendation generation, guaranteeing the numbers users self-explore always match the numbers the engine would generate."

`candidate_alternatives` is sent as an empty list — this client only ever asks for one activity's estimate per call (it's called twice per candidate: once for the baseline activity, once for the recommended one). A richer batch-estimate endpoint is not required by this contract.

If your real Carbon Calculator's request/response shape differs from this, **do not modify `generate_candidates()`, `score_candidate()`, or anything downstream.** Write a new class implementing the same three-argument `estimate()` method (copy `HttpCarbonCalculationClient` as a starting point). That boundary — one class, one method, swappable — is what keeps the integration surface small.

### 3.2 `InMemoryCarbonCalculationClient` — for tests

```python
client = InMemoryCarbonCalculationClient()
client.register("chicken_curry_cooked", 6.9, "Poore_Nemecek_2021", "v3")
client.register("ev_solo_commute", 0.053, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="GLOBAL")
client.register("ev_solo_commute", 0.028, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="IN_PUNJAB")
```

Falls back from a region-specific factor to the `"GLOBAL"`-registered one if no region-specific entry exists — mirroring how a real emission-factor provider typically defaults to a global average (see `03-database-schema.sql`'s `emission_factors` table, `region_code DEFAULT 'GLOBAL'`).

### 3.3 `MockCarbonCalculationClient` — for the demo UI only

Lives in `orchestrator.py`, not `recommendation_engine.py` — deliberately kept out of the engine module so it can never be mistaken for something production-adjacent. Two layers:

1. **A curated table** (`_MOCK_FACTORS`, 16 entries) — illustrative numbers for the original 10-rule `RULE_LIBRARY`'s activity keys (chicken/paneer/lentil curries, commute modes, standby power, plastic bottles).
2. **A category fallback** (`_CATEGORY_FALLBACK_FACTOR`, one flat number per `Category`) — added when the live pipeline was wired to the 104-entry knowledge base, which references ~197 distinct activity keys the curated table doesn't cover (`"balloon"`, `"diaper"`, `"napkin"`, and 40 other units the original demo table was never meant to handle). Rather than hand-inventing ~180 more specific-looking mock numbers, an unknown `activity_key` falls back to a flat per-category illustrative value, labelled `source="MOCK_DATA_CATEGORY_FALLBACK"` — even more clearly non-authoritative than the curated table's plain `"MOCK_DATA"` label.

Every mock estimate — curated or fallback — carries a source string starting with `MOCK_DATA`, and `orchestrator.py`'s module docstring calls this out explicitly: *"Illustrative, not authoritative, factors — fine for a UI demo, wrong for production."* The demo UI's side panel also renders a "MOCK DATA" tag.

Raises `KeyError` (matching the contract) when an `activity_key` has no curated entry **and** no known category (i.e. it's not even present in the knowledge base) — the fallback only ever activates for a *known* activity key from a *known* category, never as a blanket catch-all.

---

## 4. Swapping in the real Carbon Engine

This is designed to be a one-line change, not a rewrite. The single call site is `demo_server.py`:

```python
# today:
CARBON_CLIENT = build_demo_client()   # -> MockCarbonCalculationClient()

# becomes:
from recommendation_engine import HttpCarbonCalculationClient
CARBON_CLIENT = HttpCarbonCalculationClient(base_url="https://your-carbon-calculator.example.com")
```

`orchestrator.get_recommendations()`, `orchestrator.InMemoryUserStore`, and `demo_server.py` all depend only on the `CarbonCalculationClient` *protocol*, never on `MockCarbonCalculationClient` specifically — verified by the fact that every call site's type hint reads `carbon_client: CarbonCalculationClient`, never a concrete class.

### What does NOT change when you swap clients

- `generate_candidates()` / `generate_candidates_from_selections()` — same two `estimate()` calls, same `KeyError`-skip behavior.
- `score_candidate()` — reads `candidate.saved_kg_co2e`, already computed, never touches a client.
- `aggregate_user_carbon_baseline()` — same `estimate()` call pattern, same `KeyError`-skip.
- `dynamic_candidate_generator.py`, `profile_confidence.py`, `linucb.py`, `linucb_features.py`, `reward_mapping.py` — none of these import or call anything carbon-related at all. Personalization and ranking are entirely downstream of a `co2e_kg` number already having been produced.

### What you're responsible for on the real Carbon Engine side

- Recognising every `activity_key` the 104-entry knowledge base (`recommendations_data.py`) actually uses (197 distinct keys across ~40 units at the time of writing) — or accepting that unrecognised ones will simply never generate a candidate (never guessed at).
- Region-code-aware factors where they matter (the EV example is the sharpest illustration: `IN_PUNJAB`'s cleaner grid vs `IN_COAL_HEAVY`'s dirtier one, same activity key).
- Returning `calculation_confidence` meaningfully if you want it to matter — it currently flows into `RecommendationCandidate.estimate_confidence` (averaged between baseline and recommended) but nothing in this pipeline gates behaviour on it strictly.

---

## 5. What this repository explicitly does NOT do

- **No duplicate Carbon Engine.** There is no second, competing emissions-calculation code path anywhere in this repo. `MockCarbonCalculationClient` and `InMemoryCarbonCalculationClient` are stand-ins for testing/demoing the *shape* of the integration, not alternative implementations of carbon science.
- **No local emissions formulas.** Search the codebase for `* factor` or similar local multiplication against a raw emission-factor value outside of a `CarbonCalculationClient.estimate()` implementation — there isn't one.
- **No invented factors for unknown activities.** Missing data is handled by skipping the candidate (`KeyError` → `None` → dropped), never by defaulting to zero or an assumed average, except inside the explicitly-labelled demo mock client described above.

---

## 6. Real Carbon Engine integration checklist

1. Implement a class satisfying `CarbonCalculationClient` (copy `HttpCarbonCalculationClient` if your API matches `04-api-design.md` §9's shape; write a new one if it doesn't).
2. Point `demo_server.py` (or your real production entry point once one exists — see `RECOMMENDATION_ENGINE.md` §9 for what's not yet built) at it.
3. Confirm your service recognises (or gracefully 404s/errors on) the activity keys in `recommendations_data.py` — run `engine/diagnostics_dynamic_vs_legacy.py`-style smoke checks against your real client to see how much of the 104-entry corpus actually prices successfully.
4. Nothing else changes. If something else *does* need to change, that's a sign the new client doesn't actually satisfy the protocol — fix the client, not the pipeline.
