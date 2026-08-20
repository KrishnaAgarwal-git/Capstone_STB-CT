# Recommendation Engine — Architecture

This document describes the recommendation system as it actually exists in `engine/` — what generates candidates, what ranks them, what learns from feedback, and how personalization changes over a user's lifecycle. It does not describe the original `01-06-*.md` specification documents' aspirations where the implementation diverged from them; divergences are called out explicitly where they occur.

---

## 1. Pipeline, end to end

```
Activity Data (Activity records: category, subtype, quantity, unit, occurred_at)
        │
        ├──────────────────────────────┐
        ▼                              ▼
mine_patterns_from_activities   compute_data_confidence
(orchestrator.py)               (profile_confidence.py)
        │                              │
        ▼                              ▼
BehaviourPattern list          DataConfidenceProfile
(per pattern-type/dimension    (confidence_tier: cold /
 confidence, from mine_pattern  developing / established —
 in recommendation_engine.py)   driven by activity volume/
        │                       spread/recency, NEVER account age)
        └───────────────┬──────────────┘
                         ▼
        generate_dynamic_candidates()  (dynamic_candidate_generator.py)
        filters the 104-entry knowledge base (knowledge_base.py /
        recommendations_data.py) down to a per-user, per-round eligible
        pool, tier-gated + relevance-scored
                         │
                         ▼
        CandidateSelection list (definition, relevance_score, matched_pattern, matched_via)
                         │
                         ▼
        generate_candidates_from_selections()  (recommendation_engine.py)
        prices each selection through CarbonCalculationClient.estimate()
        (see CARBON_ENGINE_INTEGRATION.md) — skips anything the Carbon
        Engine has no factor for
                         │
                         ▼
        RecommendationCandidate list (priced: saved_kg_co2e, percent_reduction, ...)
                         │
                         ▼
        _attach_linucb_scores()  (orchestrator.py) — OPTIONAL
        scores each candidate against the shared LinUCB model
        (linucb.py + linucb_features.py), read-only
                         │
                         ▼
        rank_and_filter()  (recommendation_engine.py)
        1. score_candidate() — rules-based weighted score, BLENDED with
           the LinUCB opinion when one was attached (30% LinUCB / 70%
           rules-based — see §5)
        2. drop suppressed / disabled-category / below-threshold candidates
        3. sort by final_score descending
        4. category-balance: one per category first, backfill if too few
           categories survive
                         │
                         ▼
        Selected RecommendationCandidate list (≤ max_per_day, default 3)
                         │
                         ▼
        _to_notification()  (orchestrator.py)
        reshape into RecommendationNotification (flat, JSON-serializable)
                         │
                         ▼
        Delivered to user (demo_server.py's JSON API / demo_ui/index.html)
                         │
                         ▼
        User responds  →  FeedbackEvent (accepted/dismissed/ignored/
                           partially_completed/behaviour_confirmed/
                           behaviour_unchanged)
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
   process_feedback()      reward_mapping.reward_for_feedback_event()
   (recommendation_engine   + LinUCB.update()
   .py) — nudges            (orchestrator.py's InMemoryUserStore
   category_acceptance_     .record_feedback())
   rate, cooldowns,
   soft-suppression
              │                     │
              ▼                     ▼
   UserContext mutated in    Shared LinUCB arm state updated
   place (read by next             │
   rank_and_filter call)           ▼
                             NEXT ROUND: same arm scored
                             differently, ranking shifts
```

Two independent consumers read every `FeedbackEvent`: the pre-existing rules-based mechanism (`process_feedback`) and the LinUCB reward mapping. Neither replaces the other (see §6).

---

## 2. Repository layout (`engine/`)

| File | Role |
|---|---|
| `recommendation_engine.py` | The reference engine: domain types (`Activity`, `Category`, `BehaviourPattern`, `RecommendationCandidate`, `UserContext`, ...), pattern mining (`mine_pattern`), the static `RULE_LIBRARY` + `generate_candidates()` (kept for its own test suite, no longer the live candidate source), scoring (`score_candidate`, now LinUCB-blend-aware), ranking (`rank_and_filter`), feedback processing (`process_feedback`), explanation generation. 1,676 lines, the largest file, deliberately still a pure-function module with no storage/HTTP/orchestration concerns. |
| `orchestrator.py` | The swappable seam: wires activities → patterns → carbon pricing → candidates → LinUCB scoring → ranking → notifications, in the right order, without reimplementing any of it. Owns `MockCarbonCalculationClient`, `InMemoryUserStore` (the stateful demo store, including the shared `LinUCB` model), and `seed_demo_activities` (demo data generation). 684 lines. |
| `knowledge_base.py` | Schema (`RecommendationDefinition`) + validation (`validate_knowledge_base`) for the recommendation corpus. No carbon math, no recommendation_engine.py-specific coupling beyond importing `Category`/`Difficulty`. |
| `recommendations_data.py` | The actual 104-entry corpus (`RECOMMENDATIONS`), organized by category. |
| `profile_confidence.py` | `compute_data_confidence()` — the account-age-free maturity signal (`DataConfidenceProfile`). |
| `dynamic_candidate_generator.py` | `generate_dynamic_candidates()` — tier-gated, relevance-scored retrieval over the knowledge base, per-category-capped. |
| `linucb.py` | The contextual bandit itself — domain-agnostic (arm_id strings, numeric context vectors), no dependency on anything else in this list. |
| `linucb_features.py` | Builds the 22-feature context vector LinUCB scores against, from `(UserContext, DataConfidenceProfile, CandidateSelection)`. |
| `reward_mapping.py` | Turns a `FeedbackEvent` into a bounded `[-1, 1]` reward for `LinUCB.update()`, and documents `RECOMMENDED_ALPHA`. |
| `demo_server.py` | stdlib-only local HTTP server exposing the pipeline for `demo_ui/index.html` — explicitly not a production API design (see `04-api-design.md` for that). |
| `diagnostics_dynamic_vs_legacy.py` | A read-only diagnostic harness comparing the live (KB-driven) pipeline against the legacy RULE_LIBRARY path across 5 seeded profiles — informational, never wired into any live path. |
| `test_*.py` (12 files, 157 tests) | See §11. |

---

## 3. The knowledge base

`recommendations_data.py` defines 104 `RecommendationDefinition` entries:

| Category | Count | Cold-start-eligible | `requires_mature` |
|---|---|---|---|
| Food | 18 | 8 | 0 |
| Transport | 18 | 6 | 3 |
| Electricity | 16 | 10 | 5 |
| Lifestyle | 16 | 14 | 0 |
| Shopping | 14 | 14 | 0 |
| Waste | 14 | 14 | 0 |
| Water | 8 | 6 | 1 |
| **Total** | **104** | **72** | **9** |

Each entry (`RecommendationDefinition`, `knowledge_base.py`) carries: `id`, `category`, `title`, `description_template`, `action_type`, `baseline_activity_key` / `recommended_activity_key` (what the Carbon Engine prices), `default_quantity`, `unit`, `difficulty`, `tags`, `applicable_pattern_types`, `cold_start_eligible`, `requires_mature`, `estimated_impact_band` (`low`/`medium`/`high`), `conditions` (free-form dict), `source_note`.

`validate_knowledge_base()` checks for duplicate ids, empty titles/descriptions, invalid category/difficulty enum values, malformed `{placeholder}` tokens, negative quantities, missing units/activity keys. **This validation exists and is tested against the real corpus (`test_knowledge_base.py::test_validation_passes_clean`) but is not automatically enforced at import/load time anywhere** — a future hardening step would call it once at application startup and fail fast on any problem, rather than only in CI.

The original spec's `RULE_LIBRARY` (10 hand-written `SwapRule` entries in `recommendation_engine.py`) is a subset of this corpus in spirit, kept alive only for `generate_candidates()`'s own test suite (`test_recommendation_engine.py`). **It is not the live candidate source.**

---

## 4. Personalization signals

### 4.1 `DataConfidenceProfile` (`profile_confidence.py`)

Computed from a user's raw `Activity` list only — **never from account age or account creation date**. This is the fix for the original spec's assumption #6 (`01-overview-and-architecture.md`: *"Cold start = first 7 days of account age"*), which this implementation deliberately supersedes.

```
total_records, active_days, category_coverage, categories_covered,
date_range_days, recency_days
        │
        ▼
completeness_score = 0.50·volume_score + 0.30·spread_score + 0.20·active_days_score
    volume_score       = min(total_records / 20, 1.0)
    active_days_score  = min(active_days / 7, 1.0)
    spread_score       = categories_covered / 7
        │
        ▼
recency_factor = exponential_decay(recency_days, half_life=21.0)
        │
        ▼
overall_confidence = 0.70·completeness_score + 0.30·recency_factor
        │
        ▼
confidence_tier:  < 0.35 → "cold"   0.35-0.65 → "developing"   ≥ 0.65 → "established"
```

Reuses `exponential_decay` from `recommendation_engine.py` (same half-life as pattern mining) and the same 0.35/0.65 thresholds as `BehaviourPattern.is_early`/`is_mature` — one shared vocabulary across the codebase for "how much do we trust this signal."

### 4.2 `BehaviourPattern` confidence (`recommendation_engine.py::mine_pattern`)

Per-pattern (not per-profile) confidence, used both for candidate eligibility (`applicable_pattern_types` matching) and for the `requires_mature` gate:

```
confidence = base_rate_signal × recency_weight × consistency_weight
base_rate_signal  = occurrences / eligible_opportunities
recency_weight    = exponential_decay(days_since_last_occurrence, half_life=21)
consistency_weight = 1 - coefficient_of_variation(inter_occurrence_gaps)
```

`is_early` = `0.35 ≤ confidence < 0.65`; `is_mature` = `confidence ≥ 0.65`.

### 4.3 Two independent maturity axes, both required for `requires_mature`

`dynamic_candidate_generator.generate_dynamic_candidates()` gates a `requires_mature=True` definition on **both**:
1. `profile.confidence_tier == "established"` (the whole-profile signal), **and**
2. the specific matching `BehaviourPattern.is_mature` (the individual-pattern signal).

A user who only ever logs one category — even with a perfectly consistent, individually-mature pattern in it — stays capped at `"developing"` tier (low `spread_score`) and never unlocks `requires_mature` recommendations. This was verified concretely while building `test_mature_personalization_lifecycle.py`.

### 4.4 Personal carbon baseline (`aggregate_user_carbon_baseline`)

Per-user, per-category average kg CO2e **per active day** (not per calendar day — a category logged on 3 of 28 days is compared against "what a typical day of this behaviour costs," not diluted by the 25 days it wasn't logged). Feeds `UserContext.category_avg_daily_kg`, which `normalise_carbon_savings()` uses so a 2kg saving means something different to a low-footprint vs high-footprint user. Falls back to a fixed global scale (`saved_kg / 5.0`) only when no baseline exists yet for that category.

---

## 5. Scoring: rules-based, LinUCB-blended

`score_candidate()` (`recommendation_engine.py`) computes a weighted sum first, exactly as the original spec describes:

| Component | Weight |
|---|---|
| `carbon_savings` (normalised against the user's own baseline) | 0.25 |
| `acceptance_probability` (per-category, from feedback history or a prior) | 0.20 |
| `pattern_confidence` | 0.15 |
| `context_relevance` (is *today* the right day for this?) | 0.12 |
| `preference_fit` (dietary constraints — category-disabled soft signal too, see §7) | 0.10 |
| `convenience` (inverse of difficulty) | 0.07 |
| `category_priority` (user's stated goal weighting) | 0.05 |
| `peer_relevance` (friend-group signal, degrades to neutral 0.5 without peer data) | 0.06 |
| minus `fatigue_penalty`, minus `repetition_penalty` | — |

Clamped to `[0, 1]` → `rules_based_final`.

**Then, only if a LinUCB opinion was attached this round** (`candidate.linucb_score is not None`):

```
linucb_component = clamp01((linucb_score + 1.0) / 2.0)     # -1→0.0, 0→0.5, +1→1.0
final = 0.7 · rules_based_final + 0.3 · linucb_component    # BLEND_WEIGHT_LINUCB = 0.3
```

When no LinUCB score is attached (the default everywhere it isn't explicitly wired), `final_score` is **byte-for-byte identical** to the score before LinUCB existed — verified by the full pre-existing 41-test suite passing unmodified after the blend was added. This was a deliberate instruction: blend, don't replace. `BLEND_WEIGHT_LINUCB=0.3` is a documented, conservative starting point, not a claim of optimality — the rules-based score already encodes signals (carbon savings, cooldowns, dietary constraints) LinUCB doesn't see at all.

This design also happens to match the original spec's own stated intent (`01-overview-and-architecture.md` assumption #7): *"ML is introduced later as a re-ranker on top of the rule-based candidate generator"* — LinUCB re-ranks what the rules-based system already generates and scores; it does not generate candidates itself.

---

## 6. LinUCB

### 6.1 What it is

A real disjoint contextual bandit (Li, Chu, Langford, Schapire 2010) — one independent ridge-regression state `(A_a, b_a)` per **arm**, where an arm is a `RecommendationDefinition.id` (e.g. `"ELE-001"`). The model is **shared globally across all users** (`InMemoryUserStore` owns exactly one `LinUCB` instance) — personalization comes entirely from the per-round **context vector**, not from separate per-user models. This mirrors the architecture's own literature precedent (arms = news articles, shared across readers; personalization = reader features).

```
theta_a = A_a^-1 · b_a
score(a, x) = theta_a · x  +  alpha · sqrt(x^T A_a^-1 x)
                 ^predicted mean          ^exploration bonus

update(a, x, r):  A_a += x·x^T ;  b_a += r·x
```

`linucb.py` is deliberately domain-agnostic — no import of `recommendation_engine`, `knowledge_base`, or anything else. It takes arm-id strings, `list[float]` context vectors, and float rewards, and nothing more.

### 6.2 The context vector (`linucb_features.py`)

22 features, every one bounded `[0, 1]`, built from `(UserContext, DataConfidenceProfile, CandidateSelection)`:

`bias`, `pattern_confidence`, `pattern_is_mature`, `relevance_score`, `category_gap_score`, `profile_overall_confidence`, `profile_completeness_score`, `tier_cold`/`tier_developing`/`tier_established` (one-hot), `category_acceptance_rate`, `category_priority_weight`, `fatigue_level`, `category_disabled`, `difficulty_convenience`, `requires_mature`, `cold_start_eligible`, `estimated_impact_band`, `matched_via_pattern_match`/`matched_via_category_gap_boost`/`matched_via_cold_start_default` (one-hot), `category_avg_daily_kg_norm` (capped at an illustrative 10 kg/day).

Reuses `recommendation_engine.py`'s existing `DEFAULT_ACCEPTANCE_PRIORS` and `DIFFICULTY_CONVENIENCE_COST` rather than duplicating them. Never reads `account_age_days` anywhere — enforced by a signature-introspection test.

### 6.3 Hyperparameters

- `ridge_lambda = 1.0` (default, standard choice — `A_a` initialised to `1.0 · I`).
- `alpha = RECOMMENDED_ALPHA = 0.2` (`reward_mapping.py`), empirically calibrated against this feature space's typical vector norm (≈2.5–3.5) and this reward mapping's `[-1, 1]` range. A generic `alpha=1.0` was found (and documented) to make a never-tried arm's exploration bonus (~3.0) permanently exceed the achievable exploit ceiling (~1.0) — correct LinUCB behaviour, but miscalibrated for this domain. At `alpha=0.2`, a single strong feedback event is already enough to move an arm to the top (or bottom) of the ranking and hold there under repeated consistent feedback.

### 6.4 Persistence

`LinUCB.to_state()` / `LinUCB.from_state()` produce/consume a JSON-serialisable snapshot of every arm's `(A_a, b_a)` plus hyperparameters. **No file or database write happens automatically** — `InMemoryUserStore`'s model lives only in process memory and is lost on restart, exactly like the rest of `InMemoryUserStore`'s state. This is the seam a real persistence layer would hook into.

---

## 7. Feedback loop

Two **independent** consumers read every `FeedbackEvent` (`recommendation_engine.py::FeedbackEvent`: `user_id`, `recommendation_id`, `category`, `action_type`, `event_type`, `occurred_at`):

**1. `process_feedback()`** (pre-existing, untouched by LinUCB's addition) — nudges `UserContext.category_acceptance_rate` by a small, recency-weighted delta (`FEEDBACK_DELTA`: `BEHAVIOUR_CONFIRMED +0.12` down to `DISMISSED -0.12`), refreshes a 14-day rejection cooldown on `DISMISSED`, and soft-suppresses a category after 3 consecutive dismissals (`CONSECUTIVE_DISMISSAL_SUPPRESSION_THRESHOLD`).

**2. `reward_mapping.reward_for_feedback_event()` + `LinUCB.update()`** (`orchestrator.py::InMemoryUserStore.record_feedback`) — rescales the *same* `FEEDBACK_DELTA` table onto `[-1, 1]` (dividing through by its largest-magnitude entry, preserving the exact relative ordering rather than inventing a second opinion about feedback valence) and calls `LinUCB.update(arm_id, context_vector, reward)`, using the **exact context vector the candidate was scored/shown with** — remembered in `InMemoryUserStore._last_linucb_context`, not recomputed later (recomputation could silently drift if the user's profile changed in between).

Verified end-to-end: a single `ACCEPTED` event moves a real arm's `predict_mean` from `0.0` to `0.59`, isolated from the cooldown mechanism (checked using `ACCEPTED`, which doesn't trigger suppression) to prove LinUCB itself learned, not just that the older mechanism reacted.

---

## 8. Fatigue, cooldowns, category diversity, and disabled categories

- **`fatigue_penalty`** — `ctx.fatigue_level × 0.3`, subtracted from the rules-based score.
- **`repetition_penalty`** — linear penalty inside a 3-day cooldown window per exact `(user, category, action_type)` fingerprint.
- **`is_suppressed`** — hard 14-day exclusion after a `DISMISSED` event on the same fingerprint. Independent of score — LinUCB cannot resurrect a suppressed candidate (verified explicitly).
- **`disabled_categories`** — **now a hard filter** in `rank_and_filter()` (`c.category not in ctx.disabled_categories`, alongside `is_suppressed`). This was originally only a soft `preference_fit → 0` scoring penalty (one weighted term worth 0.10) with nothing hard-excluding it — found and fixed as part of this build; see the commit history / `test_category_diversity_under_linucb.py::TestDisabledCategoryHardFilter` for the concrete before/after demonstration.
- **Category balancing** — `rank_and_filter()`'s step 4: one candidate per category first (walking the globally-sorted list), backfilling with duplicates only when too few distinct categories survive to fill `max_per_day`. Verified to hold even after heavily, one-sidedly training LinUCB on a single category's arms (electricity favoured, but never monopolising every slot) — and to legitimately *not* hold once enough categories are genuinely exhausted (e.g. by real repeated dismissals), which is correct, not a bug.

---

## 9. Personalization lifecycle

The original three-phase framing (cold / progressive / mature) holds, but the gating variable is **data density, not calendar time**:

| Phase | Driven by | What changes |
|---|---|---|
| Cold | `profile.confidence_tier == "cold"` (few/no activities) | Only `cold_start_eligible` definitions (72 of 104) are eligible at all. LinUCB has no history for most arms — scores are exploration-dominated. |
| Progressive | `"developing"` tier | Cold-start-eligible + pattern-matched definitions become eligible; `requires_mature` stays locked. LinUCB arms shown to this user start accumulating real feedback. |
| Established | `"established"` tier + individually-mature patterns | `requires_mature` definitions (9 of 104 — EV swaps, appliance upgrades) unlock. LinUCB's influence on ranking is now measurable and grows with more feedback rounds (verified over a 25-simulated-week trajectory). |

**Verified anti-regression property:** an old-calendar-age account with sparse data (`established_sparse` in the test suite — 35 days old, only 6 logged activities) never reaches `"established"` tier and never sees a `requires_mature` recommendation — even after the *shared* LinUCB model has been heavily, positively trained on that exact arm by a completely different, data-rich user. Eligibility gating (per-user, data-driven) sits upstream of and independent from LinUCB ranking (shared, context-driven), so the shared-arm architecture cannot leak inappropriate personalization across users.

---

## 10. Future knowledge-base update workflow (not implemented)

New recommendations should enter the corpus through a documented process, not live scraping or ad-hoc edits to `recommendations_data.py`:

```
Credible sustainability sources (DEFRA, IPCC AR6, peer-reviewed LCA studies, ...)
        ↓
Research / discovery (manual or tooled)
        ↓
Draft RecommendationDefinition
        ↓
validate_knowledge_base() — schema/consistency check
        ↓
Human review / approval
        ↓
Added to recommendations_data.py (or a future database-backed store)
```

No part of the live recommendation-decision path performs web scraping or dynamic corpus expansion — the 104-entry corpus is static and curated. This workflow is a description of the intended editorial process, not code that exists in this repository.

---

## 11. Tests

157 tests across 12 files, all passing except one pre-existing, unrelated, date-sensitive flake (`test_orchestrator.py::test_seed_demo_activities_at_45_days_mines_a_mature_transport_pattern` — a seeding-recipe issue, not a pipeline bug; documented and left alone since fixing `seed_demo_activities`'s own date-sensitivity was out of scope for this work).

| File | Tests | Covers |
|---|---|---|
| `test_recommendation_engine.py` | 43 | The reference engine end to end — carbon math, pattern mining, scoring, ranking, feedback, peer relevance, `rank_and_filter`'s disabled-category hard filter. |
| `test_orchestrator.py` | 10 | Pipeline wiring, seeding, the end-to-end cold/mature-tier notification shape. |
| `test_knowledge_base.py` | 16 | Corpus validation, real-corpus properties (≥100 entries, ≥3 per category, unique ids). |
| `test_dynamic_candidate_generator.py` | 12 | Tier gating, `requires_mature`'s two-stage gate, per-category cap, no-account-age signature guard. |
| `test_profile_confidence.py` | 7 | `compute_data_confidence()`'s formula components and tier thresholds. |
| `test_diagnostics_dynamic_vs_legacy.py` | 5 | The read-only legacy-vs-live comparison harness. |
| `test_linucb.py` | 20 | The bandit primitive in isolation — convergence, disjointness, exploration/exploitation, persistence. |
| `test_linucb_features.py` | 13 | Context-vector construction — boundedness, one-hot correctness, account-age-free guard. |
| `test_reward_mapping.py` | 10 | Feedback→reward rescaling, `RECOMMENDED_ALPHA` verified against real pipeline vectors. |
| `test_linucb_integration.py` | 8 | LinUCB blended into the live pipeline — opt-in behaviour, feedback reaching the model, suppression still overriding score. |
| `test_category_diversity_under_linucb.py` | 7 | Category balancing under the blend, the disabled-categories hard-filter fix. |
| `test_mature_personalization_lifecycle.py` | 6 | The full cold→established story, cross-user leakage protection, shared-model per-user personalization. |

Run the full suite: `python -m pytest -q` from `engine/`.

---

## 12. Known limitations

- Carbon numbers are entirely mock (`MOCK_DATA` / `MOCK_DATA_CATEGORY_FALLBACK`) until a real Carbon Engine is plugged in (see `CARBON_ENGINE_INTEGRATION.md`).
- No persistence beyond process memory (`InMemoryUserStore`) — `03-database-schema.sql` describes the intended schema but nothing writes to it.
- `RECOMMENDED_ALPHA=0.2` and `BLEND_WEIGHT_LINUCB=0.3` are empirically sanity-checked starting points, not rigorously globally optimized values — expected to be revisited once real usage data exists.
- `validate_knowledge_base()` is tested but not enforced at application startup.
- `demo_server.py` is explicitly a stdlib-only local demo server, not the production API surface `04-api-design.md` specifies.
- No authentication, no multi-region deployment, no A/B experiment framework wiring (the schema has `experiments`/`experiment_assignments` tables; nothing in `engine/` populates them).
