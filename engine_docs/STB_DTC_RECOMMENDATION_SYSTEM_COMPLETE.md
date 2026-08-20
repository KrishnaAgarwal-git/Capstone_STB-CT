# STB-DTC Recommendation Engine — Complete Technical Record

This is the authoritative record of what was actually built, verified, and shipped in this repository's `engine/` directory. It is generated from the final code, not from planning documents — where the original specification (`01-06-*.md`) and the implementation diverge, that divergence is stated explicitly, not glossed over. Anything described here as "implemented" was run and its behavior confirmed against real inputs during development, not merely written and assumed correct.

---

## 1. Executive summary

The system takes a user's logged sustainability-relevant activities (food, transport, electricity, water, shopping, waste, lifestyle), determines how much can be reliably known about that user's real behaviour (independent of how long ago they signed up), retrieves a relevant subset of a 104-entry curated recommendation library, ranks that subset using a blend of a hand-tuned scoring formula and a live contextual bandit (LinUCB) that learns from feedback, and returns 1–3 recommendations per round with a full, auditable "why am I seeing this" trace. User feedback closes the loop into both the scoring formula's inputs and the bandit's model state, so recommendations genuinely personalize over time — without ever conflating account age with actual behavioural evidence.

**What is real:** the entire decision pipeline (pattern mining → data-confidence scoring → candidate retrieval → carbon pricing → rules-based scoring → LinUCB blend → ranking → feedback → learning), running against a real 104-entry knowledge base, verified end-to-end with 157 automated tests plus targeted live sanity checks against the demo server.

**What is mocked:** every kg CO2e number (clearly labelled `MOCK_DATA*`), because the real Carbon Calculation Service is a separate, external system this repository integrates against but does not implement (see `CARBON_ENGINE_INTEGRATION.md`).

**What is not built:** persistence beyond process memory, authentication, the production API surface described in `04-api-design.md` (a stdlib demo server stands in for it), and a knowledge-base update tooling pipeline.

---

## 2. Repository structure

```
recommendation-engine/
├── README.md
├── 01-overview-and-architecture.md      original spec, unmodified
├── 02-recommendation-algorithm.md       original spec, unmodified
├── 03-database-schema.sql               original spec, unmodified — designed, not implemented
├── 04-api-design.md                     original spec, unmodified — designed, not implemented
├── 05-frontend-and-ux.md                original spec, unmodified
├── 06-testing-analytics-roadmap.md      original spec, unmodified
├── ORIGINAL_PROJECT_README.md
├── CARBON_ENGINE_INTEGRATION.md         this document's sibling — Carbon Engine contract
├── RECOMMENDATION_ENGINE.md             this document's sibling — architecture deep-dive
├── STB_DTC_RECOMMENDATION_SYSTEM_COMPLETE.md   (this file)
├── demo_ui/
│   └── index.html                       single-page demo UI (no build step)
└── engine/
    ├── recommendation_engine.py         1,676 lines — reference engine (types, scoring, ranking, feedback)
    ├── orchestrator.py                    684 lines — pipeline wiring, mock carbon client, InMemoryUserStore
    ├── knowledge_base.py                  167 lines — RecommendationDefinition schema + validation
    ├── recommendations_data.py          2,055 lines — the 104-entry corpus
    ├── profile_confidence.py              282 lines — DataConfidenceProfile / compute_data_confidence
    ├── dynamic_candidate_generator.py      309 lines — tier-gated candidate retrieval
    ├── linucb.py                          199 lines — disjoint contextual bandit primitive
    ├── linucb_features.py                 218 lines — context-vector construction
    ├── reward_mapping.py                  106 lines — feedback → LinUCB reward, alpha calibration
    ├── demo_server.py                     214 lines — stdlib HTTP server for the demo UI
    ├── diagnostics_dynamic_vs_legacy.py    199 lines — read-only legacy-vs-live comparison
    └── test_*.py (12 files)             ~3,175 lines — 157 tests
```

Total: ~9,284 lines across 23 Python files (11 implementation, 12 test).

---

## 3. Technology stack

- **Language:** Python 3.11.
- **Standard library only** for the demo server (`http.server`, `json`, `urllib.parse`) — zero `pip install` required to run the demo.
- **numpy** (2.2.5 at time of writing) — used exclusively inside `linucb.py` for the ridge-regression matrix bookkeeping (`A_a`/`b_a`, matrix inversion). Not used anywhere else in `engine/`.
- **pytest** (9.1.1) — the entire test suite; also runnable via plain `unittest` (several test files use `unittest.TestCase` directly).
- **No database** in the running system — `InMemoryUserStore` is the only persistence, in-process, lost on restart. `03-database-schema.sql` (PostgreSQL 15+, `pgcrypto`, UUID PKs) describes the intended real schema but nothing in `engine/` connects to Postgres.
- **No frontend framework** — `demo_ui/index.html` is a single static page with no build step.

---

## 4. Data flow (concrete)

```
1. Activity(user_id, category, subtype, quantity, unit, occurred_at)  [logged behaviour]
        ↓
2. mine_patterns_from_activities()  →  BehaviourPattern[]  [confidence-scored recurring behaviour]
   compute_data_confidence()        →  DataConfidenceProfile  [account-age-free maturity signal]
        ↓
3. generate_dynamic_candidates(definitions, patterns, profile)  →  CandidateSelection[]
   (tier-gated eligibility + relevance scoring over the 104-entry corpus,
    capped at 8 per category)
        ↓
4. generate_candidates_from_selections(selections, carbon_client)  →  RecommendationCandidate[]
   (each priced via CarbonCalculationClient.estimate() — see CARBON_ENGINE_INTEGRATION.md;
    silently skipped if the Carbon Engine has no factor for it)
        ↓
5. _attach_linucb_scores(candidates, selections, profile, ctx, linucb_model)
   (optional — read-only scoring against the shared bandit)
        ↓
6. rank_and_filter(candidates, ctx)  →  RecommendationCandidate[] (≤ 3, category-balanced)
   (score_candidate blends rules-based + LinUCB; suppression/disabled-category/
    threshold filters applied; category diversity enforced)
        ↓
7. _to_notification()  →  RecommendationNotification[]  [flat, JSON-serializable]
        ↓
8. Delivered via demo_server.py's JSON API / rendered in demo_ui/index.html
        ↓
9. User responds  →  FeedbackEvent
        ↓
10a. process_feedback()          10b. reward_mapping + LinUCB.update()
     (acceptance-rate nudge,          (bandit learns — same arm scored
      cooldowns, soft-suppression)     differently next round)
        ↓                                ↓
11. Both mutate/persist state for the NEXT round — loop back to step 1
    with richer UserContext and a more-informed shared LinUCB model
```

---

## 5. Recommendation schema

### 5.1 `RecommendationDefinition` (knowledge_base.py) — the static corpus entry

`id`, `category` (`Category` enum: food/transport/electricity/water/shopping/waste/lifestyle), `title`, `description_template`, `action_type`, `baseline_activity_key`, `recommended_activity_key`, `default_quantity`, `unit`, `difficulty` (`Difficulty` enum: easy/moderate/challenging), `tags` (tuple), `applicable_pattern_types` (tuple), `cold_start_eligible` (bool), `requires_mature` (bool), `estimated_impact_band` (`"low"`/`"medium"`/`"high"`), `conditions` (dict), `source_note`.

### 5.2 `RecommendationCandidate` (recommendation_engine.py) — the priced, scored, in-flight object

Everything above's runtime counterpart, plus: `id` (uuid), `user_id`, `trigger_type` (`rule`/`pattern`/`model`), `source_pattern` (`Optional[BehaviourPattern]`), `baseline_estimate` / `recommended_estimate` (`CarbonEstimate`, from the Carbon Engine), `tradeoff_note`, `weekly_occurrence_rate`, `knowledge_base_definition_id` (join key back to the originating `RecommendationDefinition`, added for the LinUCB integration), `linucb_score` (added for the LinUCB integration), plus derived fields computed in `__post_init__`: `saved_kg_co2e`, `percent_reduction`, `estimate_confidence`, `score_breakdown` (`ScoreBreakdown`, populated by `rank_and_filter`).

### 5.3 `RecommendationNotification` (orchestrator.py) — the delivered, flat shape

`id`, `category`, `title`, `body` (rendered explanation text), `saved_kg_co2e`, `percent_reduction`, `difficulty`, `tradeoff_note`, `confidence`, `score`, `weekly_kg_projection`, `monthly_kg_projection`. Deliberately flat/nested-object-free so it serializes straight to JSON for any frontend.

---

## 6. The 100+ recommendation knowledge base

104 entries (see `RECOMMENDATION_ENGINE.md` §3 for the full category breakdown table). Sourced originally as an expansion of the spec's 10-entry `RULE_LIBRARY`, given a new `FOO-`/`TRN-`/`ELE-`/`WAT-`/`SHP-`/`WST-`/`LIF-` id scheme. Validated by `knowledge_base.validate_knowledge_base()` (schema/consistency checks) — tested against the real corpus, not enforced automatically at load time.

197 distinct `activity_key`s are referenced across the corpus, spanning roughly 40 different `unit` strings (`kg`, `km`, `hour`, `litre`, `bag`, `napkin`, `balloon`, and many more) — a scale and heterogeneity the original demo's 16-entry mock carbon table never anticipated; the mock client's category-fallback pricing mechanism (§8, `CARBON_ENGINE_INTEGRATION.md` §3.3) exists specifically to let this corpus actually price end-to-end in the demo.

---

## 7. User profile, confidence, and baseline

Covered in full in `RECOMMENDATION_ENGINE.md` §4. Summary: `DataConfidenceProfile` (volume/spread/recency-driven, account-age-free) gates *eligibility*; `BehaviourPattern.confidence` (occurrence/recency/consistency-driven) gates *pattern-specific* relevance and the `requires_mature` fine-grained check; `aggregate_user_carbon_baseline` provides the per-user, per-category "typical day" figure that normalizes carbon-savings scoring.

**Verified anti-account-age-regression property** (the central design goal of this project): a 35-day-old account with only 6 sparse activities never reaches `"established"` tier and never unlocks `requires_mature` recommendations, even after the shared LinUCB model has 30 rounds of maximally positive training on that exact arm from a different, data-rich user.

---

## 8. Feature engineering (LinUCB's 22-dimensional context vector)

Full list and rationale in `RECOMMENDATION_ENGINE.md` §6.2. Every feature is bounded `[0, 1]`; the vector is built per `(user, candidate)` decision point from `UserContext` + `DataConfidenceProfile` + `CandidateSelection`, reusing existing constants (`DEFAULT_ACCEPTANCE_PRIORS`, `DIFFICULTY_CONVENIENCE_COST`) rather than duplicating them. Measured typical L2 norm across real generated candidates: ≈2.5–3.5.

---

## 9. Candidate generation

Two parallel implementations exist, only one of which is live:

| | `generate_candidates()` (legacy) | `generate_candidates_from_selections()` (live) |
|---|---|---|
| Candidate source | `RULE_LIBRARY` (10 hand-written `SwapRule`s) | 104-entry knowledge base via `generate_dynamic_candidates()` |
| Cold-start gate | `account_age_days < 7 or len(patterns) == 0` | `profile.confidence_tier` (data-driven) |
| Used by | Its own test suite only (`test_recommendation_engine.py`) | `orchestrator.get_recommendations()` and `InMemoryUserStore.get_recommendations()` — the actual live path |
| Carbon pricing | `_price_and_build_candidate()` (shared helper) | Same shared helper — no duplicated pricing logic between the two paths |

The legacy path is retained deliberately (per the "don't rebuild what's correct" instruction governing this project) as a reference implementation and regression-tested baseline, not because it's still in use.

---

## 10. LinUCB — the contextual bandit

Full mathematical description in `RECOMMENDATION_ENGINE.md` §6. Key facts:

- Real disjoint LinUCB (Li et al. 2010), not a renamed weighted score — `predicted_mean + alpha·√(xᵀA⁻¹x)`, verified via dedicated unit tests for predicted-mean convergence, arm independence (the "disjoint" property), and exploration/exploitation trade-off behaviour under varying `alpha`.
- **Shared across all users** — arms are `RecommendationDefinition.id`s, not per-user. Personalization is entirely a function of the context vector.
- **Blended, not a replacement**, into `score_candidate()`'s existing rules-based score (`BLEND_WEIGHT_LINUCB = 0.3`), per explicit instruction. Verified byte-for-byte backward-compatible when no LinUCB score is attached.
- `RECOMMENDED_ALPHA = 0.2`, empirically calibrated (not asserted) against real pipeline vector norms and this system's actual reward scale.
- State (`to_state()`/`from_state()`) is JSON-serializable but nothing writes it to disk automatically in this implementation — an open persistence seam.

---

## 11. Reward mapping

`reward_mapping.py` rescales `recommendation_engine.py`'s existing `FEEDBACK_DELTA` table (already-tuned relative valence: `BEHAVIOUR_CONFIRMED +0.12` down to `DISMISSED -0.12`) onto `[-1, 1]` by dividing through by its largest-magnitude entry — preserving the exact same ordering rather than introducing a second, independent opinion about feedback valence:

| `FeedbackType` | Reward |
|---|---|
| `behaviour_confirmed` | **+1.0000** |
| `accepted` | +0.6667 |
| `partially_completed` | +0.2500 |
| `ignored` | -0.2500 |
| `behaviour_unchanged` | -0.4167 |
| `dismissed` | **-1.0000** |

---

## 12. Feedback loop

Two independent consumers of every `FeedbackEvent` — see `RECOMMENDATION_ENGINE.md` §7 for the full mechanism description. Verified end-to-end (not just at the unit level) that a single `ACCEPTED` event moves a real arm's LinUCB `predict_mean` from `0.0` to `0.59`, isolated from the pre-existing cooldown mechanism to prove the bandit itself learned.

---

## 13. APIs

`demo_server.py` exposes a small JSON API — explicitly a local, no-auth, stdlib-only stand-in, **not** the production API surface `04-api-design.md` specifies:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` , `/index.html` | Serve the demo UI |
| `GET` | `/static/*` | Serve demo UI assets |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/users` | List pre-seeded demo user ids |
| `GET` | `/api/users/{id}/recommendations` | Run the full live pipeline for one user, return notifications |
| `GET` | `/api/users/{id}/baseline` | Return `aggregate_user_carbon_baseline()`'s per-category figures |
| `POST` | `/api/users/new` | Create + seed a new demo user |
| `POST` | `/api/users/{id}/feedback` | Record a `FeedbackEvent` — drives both `process_feedback()` and (through `InMemoryUserStore`) the LinUCB update |

`04-api-design.md` describes a richer, production-shaped surface (`POST /api/v1/recommendations/preview`, `GET /api/v1/recommendations/{id}/explanation`, etc.) — that document's design was not implemented as running code in this repository; it remains the specification for a real backend to build against.

---

## 14. Storage / database

**Implemented:** `InMemoryUserStore` (`orchestrator.py`) — a plain Python dict-backed store for activities, `UserContext`, dismissal streaks, last-shown candidates (for feedback recovery), last-shown LinUCB context vectors, and the one shared `LinUCB` model instance. All state is lost on process restart.

**Designed, not implemented:** `03-database-schema.sql` — 14 PostgreSQL tables (`users`, `user_preferences`, `activities`, `emission_factors`, `carbon_logs`, `behaviour_patterns`, `recommendation_candidates`, `recommendations`, `recommendation_explanations`, `accepted_recommendations`, `rejected_recommendations`, `feedback_events`, `notification_logs`, `experiments`/`experiment_assignments`) plus a materialized view for acceptance-rate analytics. Nothing in `engine/` connects to Postgres; this schema is the intended target for swapping `InMemoryUserStore` for real persistence.

---

## 15. Configuration / hyperparameters (all in code, not externalized to a config file)

| Name | Value | Location |
|---|---|---|
| `MIN_DISPLAY_SCORE` | 0.45 | `recommendation_engine.py` |
| `WEIGHTS` (8-component scoring weights) | sum to 1.0 | `recommendation_engine.py` |
| `BLEND_WEIGHT_LINUCB` | 0.3 | `recommendation_engine.py` |
| `CONSECUTIVE_DISMISSAL_SUPPRESSION_THRESHOLD` | 3 | `recommendation_engine.py` |
| `SOFT_SUPPRESSION_DAYS` | 30 | `recommendation_engine.py` |
| `RECOMMENDED_ALPHA` (LinUCB exploration) | 0.2 | `reward_mapping.py` |
| `ridge_lambda` (LinUCB, default) | 1.0 | `linucb.py` |
| `max_per_day` (recommendations shown) | 3 | `orchestrator.py` / `recommendation_engine.py` |
| `max_per_category` (candidate pool cap) | 8 | `orchestrator.py` call sites |
| Pattern confidence thresholds | 0.35 / 0.65 | `recommendation_engine.py`, reused by `profile_confidence.py` |

---

## 16. Tests

157 tests, 12 files — full breakdown in `RECOMMENDATION_ENGINE.md` §11. One pre-existing, unrelated, date-sensitive flake (`test_orchestrator.py::test_seed_demo_activities_at_45_days_mines_a_mature_transport_pattern`), documented and left alone throughout this project's entire history — not introduced by, and not fixed by, any of the work described here.

---

## 17. Worked examples (from real runs during development)

**10-week feedback simulation** (real output, `InMemoryUserStore`, `demo_mature`-style seeded user): a genuinely-liked item (`electricity`/"Cut the Standby Drain", accepted every week) stably held slot #1 every single week, while the other two slots rotated through 6 different categories over the run via cooldown + exploration — reinforcement and diversity coexisting, not fighting.

**Cross-user leakage check** (real output): trained the shared LinUCB model with 30 rounds of `BEHAVIOUR_CONFIRMED` feedback on the EV recommendation (`TRN-006`) from a data-rich, established-tier user with a reliably mature transport pattern; a completely different, sparse-data user never saw it — confirmed both structurally (never even eligible) and through the live pipeline.

**Disabled-category fix, live confirmation:** disabling `electricity` on a real `demo_mature` user removed "Cut the Standby Drain" from the very next round's output, with a different candidate backfilling the freed slot.

---

## 18. Implemented vs. Mocked vs. Future

| Component | Status |
|---|---|
| Pattern mining, confidence scoring | **Implemented**, original spec, unchanged |
| `DataConfidenceProfile` / account-age-free maturity | **Implemented** |
| 104-entry knowledge base | **Implemented** |
| Dynamic candidate generation (tier-gated retrieval) | **Implemented** |
| Carbon pricing integration boundary | **Implemented** (contract + 3 client implementations) |
| Actual carbon emission numbers | **Mocked** — `CARBON_ENGINE_INTEGRATION.md` |
| Rules-based scoring (`score_candidate`) | **Implemented**, original spec, unchanged |
| LinUCB contextual bandit | **Implemented**, real math, verified |
| LinUCB ↔ rules-based blend | **Implemented** (30/70 blend, opt-in, backward-compatible) |
| Feedback → reward mapping | **Implemented** |
| Feedback loop (both consumers) | **Implemented**, verified end-to-end |
| Cooldowns / fatigue / repetition suppression | **Implemented**, original spec, unchanged |
| Disabled-category hard filter | **Implemented** (fixed during this project — was previously a soft-only gap) |
| Category-wise diversity in ranking | **Implemented**, verified under the LinUCB blend |
| Explanation trace generation | **Implemented**, original spec, unchanged |
| Peer-group relevance | **Implemented**, original spec, unchanged |
| Demo HTTP API + UI | **Implemented** (explicitly non-production) |
| Persistence (database) | **Designed** (`03-database-schema.sql`), **not implemented** |
| Production API surface | **Designed** (`04-api-design.md`), **not implemented** |
| Real Carbon Calculation Service | **Out of scope** — external system, contract defined, not built here |
| Authentication | **Not implemented** |
| Knowledge-base update workflow / tooling | **Documented process only**, no tooling |
| `validate_knowledge_base()` enforcement at startup | **Not wired in** (tested, not enforced) |
| A/B experiment framework | **Schema only** — no code populates it |

---

## 19. Limitations

See `RECOMMENDATION_ENGINE.md` §12 for the full list. Highlights: mock carbon data throughout; no persistence beyond process memory; `RECOMMENDED_ALPHA`/`BLEND_WEIGHT_LINUCB` are sanity-checked starting points, not rigorously optimized; the demo server is not the production API; no auth; the corpus-validation function isn't enforced automatically.

---

## 20. Future work

1. Plug in a real `CarbonCalculationClient` implementation against the actual Carbon Calculation Service (`CARBON_ENGINE_INTEGRATION.md` §6's checklist).
2. Implement real persistence against `03-database-schema.sql`, replacing `InMemoryUserStore` (including a real store for the LinUCB model's `to_state()`/`from_state()` snapshot).
3. Build the production API surface described in `04-api-design.md`.
4. Wire `validate_knowledge_base()` into application startup as a fail-fast check.
5. Formalize the knowledge-base update workflow (§10 of `RECOMMENDATION_ENGINE.md`) with real tooling.
6. Re-tune `RECOMMENDED_ALPHA` and `BLEND_WEIGHT_LINUCB` against real usage data once available; consider whether LinUCB should eventually take a larger share of the blend (or replace the rules-based score outright) as its track record grows.
7. Populate the `experiments`/`experiment_assignments` schema for real A/B testing of ranking/scoring changes.
8. Authentication and multi-tenant hardening for anything beyond local demo use.

---

## 21. Implementation history

Built incrementally, each step audited against the actual repository state before proceeding (not assumed from prior planning), each step verified against real pipeline output (not just unit-level fixtures) before moving to the next:

```
edc86d2  Initial commit — recommendation engine + dynamic candidate generation diagnostics
2db6473  Wire dynamic candidate generator and 104-entry KB into the live pipeline
2b02434  Add LinUCB feature adapter (context-vector construction, no bandit math yet)
de8e8cf  Add LinUCB contextual bandit primitive (disjoint per-arm, no ranking wiring yet)
676c665  Add feedback-to-reward mapping and empirically calibrate LinUCB's alpha
434a2ae  Blend LinUCB into live ranking (opt-in, additive -- does not replace score_candidate)
6cacbea  Verify category-wise selection holds under the blended LinUCB ranking
2533159  Verify mature personalization end-to-end as one continuous lifecycle story
fbc9cf7  Fix: disabled_categories is now a hard filter, not just a soft scoring penalty
```
