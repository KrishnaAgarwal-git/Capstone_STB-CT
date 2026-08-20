# Personalised Carbon Recommendation Engine
## Part 6 — Testing, Analytics, ML Roadmap, Production & Privacy

---

## 1. Testing Strategy

| Layer | What's tested | Example |
|---|---|---|
| **Unit tests** | Pure functions: carbon formula, confidence decay, score components | `test_saved_co2e_calculation()`, `test_recency_decay_halflife()` |
| **Integration tests** | Service-to-service flow: ingestion → calculation → pattern update | Log 5 consecutive Thursday chicken meals → assert pattern confidence crosses 0.65 |
| **API tests** | Contract correctness, error handling, auth | `POST /activities` with negative quantity → `400 VALIDATION_ERROR` |
| **Ranking quality tests** | Given a fixed candidate set + fixed user state, output ranking is deterministic and matches expected order | Golden-file tests: snapshot expected top-3 given fixture user data |
| **Emission estimation tests** | Regression tests against known factor values; detect silent factor-version drift | Assert `chicken_v3` factor unchanged unless a deliberate migration test updates the golden value |
| **Recommendation relevance tests** | Context-gating logic (e.g. no cycling recommendation on a rainy day) | Mock weather=rain → assert cycling candidate excluded or down-scored |
| **Notification fatigue tests** | Frequency cap and auto-throttle logic | Simulate 5 consecutive dismissals → assert push frequency drops per Part 2 §4.4 |
| **A/B testing** | Statistical validity of experiment assignment and metric computation | Assert consistent hashing gives stable variant assignment across sessions |

### 1.1 A/B Testing Plan (illustrative first experiments)

1. **Card copy tone**: warm/encouraging vs. neutral/factual — measured on acceptance rate.
2. **CTA wording**: "I'll do this" vs. "Mark as done" vs. "Save this habit" — measured on tap-through.
3. **Notification cadence**: daily vs. every-other-day default — measured on 30-day retention + opt-out rate (must not regress retention to "win").
4. **Ranking weight tuning**: test `w1` (carbon savings weight) at 0.25 vs. 0.35 — measured on both acceptance rate *and* average kg saved per accepted recommendation (guards against over-indexing on acceptance at the cost of impact).

### 1.2 Success Metrics (from spec, made concrete)

```
recommendation_acceptance_rate      = accepted / shown                  (target: >35% by month 2)
avg_carbon_saved_per_acceptance     = sum(saved_kg_co2e) / accepted_count
footprint_reduction_over_time       = (baseline_month_avg - current_month_avg) / baseline_month_avg
repeat_engagement                   = % of users active (logged ≥1 activity) in week N given active in week N-1
notification_opt_out_rate           = users disabling push / total users, tracked weekly
habit_change_persistence            = % of `accepted` recs with `behaviour_confirmed=true` at day 30 follow-up
```

---

## 2. Analytics Strategy

Built on the `mv_user_acceptance_rate` pattern (Part 3) extended with additional materialised/aggregated views:

- **Acceptance rate** — by user, category, action_type, cohort (signup week), experiment variant.
- **Carbon saved over time** — daily/weekly/monthly rollups, per-user and platform-aggregate.
- **Top recommendation categories** — by volume shown and by realised savings (these can differ — a category might be shown often but rarely accepted).
- **Most effective recommendation types** — ranked by `behaviour_confirmed` rate, not just `accepted` rate (an accepted-but-not-followed-through recommendation is a weaker signal, per Part 2 §6.1).
- **Repeated rejection patterns** — feeds directly back into the suppression system (Part 2 §4) but is also surfaced to product/ops as a signal that a rule may need retiring or rewording.
- **Notification effectiveness** — open rate, tap-through rate, and critically, **opt-out rate segmented by cadence/tone experiment**.
- **Retention of behaviour change** — cohort analysis: of users who had a confirmed behaviour change at day 30, what % maintained it at day 60/90 (the real product outcome, not just engagement).

---

## 3. Future ML Roadmap

This roadmap is explicitly staged so the system stays interpretable at every step — no "black box" jump.

### Stage 0 (V1, described throughout this doc)
Rule-based candidate generation + statistical pattern mining + linear weighted scoring. Fully explainable, fast to ship, easy to debug, and — importantly — **generates the labelled training data** (acceptance/rejection/confirmation events) that later stages need.

### Stage 1 — Learned Acceptance Probability
Replace the heuristic `acceptance_probability` (Part 2 §3.2) with a logistic regression / gradient-boosted tree model trained on `feedback_events`, features: user category history, time since last similar rec, difficulty tier, day-of-week, etc. Output is still just **one input** to the same linear scoring formula — architecture doesn't change, just one component gets smarter. Model predictions are logged alongside the heuristic's prediction for a shadow-mode comparison period before cutover.

### Stage 2 — Learned Ranking (Learning-to-Rank)
Once Stage 1 has run long enough to accumulate rich comparative data (which candidate was chosen over which alternatives, and the outcome), introduce a pairwise/listwise learning-to-rank model (e.g. LambdaMART) that learns the *combination* of features rather than a fixed linear weight vector — but constrained to only re-rank the same rule-generated candidate pool, never to invent new candidate actions. Explainability is preserved by requiring the model to output feature attributions (e.g. SHAP values) that get mapped back into the same reasoning-trace schema (Part 2 §5.1) — no schema change needed downstream.

### Stage 3 — Personalised Preference Embeddings
Learn a low-dimensional embedding per user from their acceptance/rejection history (collaborative-filtering-style, similar to how Spotify models taste) to improve cold-start-to-warm transition speed for *new* users by finding behaviourally similar existing users — carefully scoped to never use this to infer sensitive attributes, and always overridable by explicit stated preferences.

### Stage 4 — Causal Impact Modelling
Move from "did the user accept" to "did the recommendation *cause* the behaviour change, vs. would it have happened anyway" — using techniques like uplift modelling / synthetic control on the `behaviour_confirmed` data, to stop crediting recommendations for changes the user was going to make regardless. This is the stage that turns "acceptance rate" from a vanity metric into a genuine causal-impact metric.

### Throughout all stages
**LLM usage stays fixed at copy-generation only** (Part 2 §5.2) — this boundary is not something the roadmap relaxes; it's a permanent architectural constraint, since carbon numbers must always be traceable to the deterministic calculation service, not a generative model.

---

## 4. Production Considerations

- **Scalability**: pattern mining is the heaviest batch job — designed to run incrementally (delta-update on new activity events) rather than full recompute, so it scales roughly linearly with new activity volume, not with total user base × history size.
- **Emission factor governance**: factor updates go through a reviewed migration process (new `version` row, `valid_from`/`valid_to` managed, never in-place mutation) so historical recommendations remain auditable against the factor that was actually used.
- **Caching**: today's recommendation set is cached (Redis) once generated for the day and invalidated only on explicit new-activity events that could plausibly change ranking (avoids recomputing on every app open).
- **Observability**: every recommendation's full scoring breakdown is logged (not just final output) to support debugging "why didn't I see X" support tickets and to build the training data for the ML roadmap.
- **Graceful degradation**: if the Emission Factor Provider or Weather API is unavailable, generation falls back to last-known-good cached factors/context rather than blocking the entire feed.
- **Cost control on LLM copy generation**: template-based rendering (Part 2 §5.2) is the default path; LLM polishing is an optional, cacheable enhancement (same reasoning trace → same polished sentence, cached per trace-hash) rather than a per-request live call.

---

## 5. Privacy & Safety

- **Consent-gated data classes**: location and calendar data are opt-in (`data_consent` JSONB in `user_preferences`), and their absence must not break core functionality — context-awareness rules degrade gracefully to time/day-of-week only when location/calendar consent is withheld (Part 1 §"If context is missing...").
- **Minimal retention**: raw activity logs older than a configurable window (e.g. 24 months) are aggregated into rollup statistics and the raw row is purged; behaviour patterns retain derived confidence scores, not raw location traces.
- **Explainable processing**: every stored pattern and recommendation is user-inspectable via the "why am I seeing this?" API (Part 4 §10) — no hidden profiling.
- **Category opt-out**: `disabled_categories` in preferences is a hard filter applied at candidate generation (not just ranking) — a disabled category never even generates candidates, so it can't leak into "why was this considered" explanations either.
- **Data export/delete**: standard right-to-access/right-to-erasure supported by the relational schema's clean FK structure (cascading deletes on `users.id` reach all dependent tables, Part 3).
- **No dark patterns**: dismiss/opt-out actions are always one tap, never buried behind confirmation flows designed to discourage them (explicit product principle, referenced in Part 5 §4).

---

*This concludes the 6-part design. See `03-database-schema.sql` for full DDL, `04-api-design.md` for endpoint contracts, and `engine/recommendation_engine.py` for a working reference implementation of the core scoring/ranking algorithm described in Part 2.*
