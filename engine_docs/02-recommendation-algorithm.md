# Personalised Carbon Recommendation Engine
## Part 2 — Recommendation Algorithm Design

---

## 1. Behaviour Mining / Pattern Detection

### 1.1 What counts as a "pattern"

A pattern is a stored, versioned belief about recurring user behaviour:

```
Pattern = {
  pattern_id,
  user_id,
  pattern_type,        # e.g. "meal_day_of_week", "transport_weekday", "shopping_periodic"
  dimensions: {...},    # e.g. {day_of_week: THU, category: "chicken"}
  occurrences,          # count of matching observations
  window_days,          # lookback window used (e.g. 56 days = 8 weeks)
  confidence,           # 0-1, see formula below
  last_observed_at,
  first_observed_at,
  strength_trend,       # increasing / stable / decaying
}
```

### 1.2 Detection approach (V1 = statistical, not ML)

For each candidate `(dimension combination)`, e.g. `(day_of_week=THU, meal_category=chicken)`:

```
confidence = base_rate_signal * recency_weight * consistency_weight

base_rate_signal   = occurrences_in_window / eligible_opportunities_in_window
                      # e.g. ate chicken on 4 of the last 6 Thursdays = 0.67

recency_weight      = decay_function(days_since_last_occurrence)
                      # exponential decay, half-life ~21 days — a pattern not
                      # seen in 2 months shouldn't drive today's recommendation

consistency_weight   = 1 - (coefficient_of_variation of inter-occurrence gaps)
                      # punishes noisy/irregular "patterns" that are really just
                      # coincidence (occurred 4 times but at random days ≠ real pattern)
```

Thresholds:
- `confidence < 0.35` → pattern not stored / discarded as noise
- `0.35 ≤ confidence < 0.65` → "early pattern," used only for hedged, low-specificity recommendations ("You've been driving a lot on weekdays lately...")
- `confidence ≥ 0.65` → "mature pattern," eligible for specific personalised recommendations

### 1.3 Pattern families mined

| Pattern type | Dimensions | Example |
|---|---|---|
| `meal_day_of_week` | day, food_category | chicken every Thursday |
| `transport_weekday` | day_type (weekday/weekend), mode, distance_bucket | drives 6km weekdays |
| `transport_time_of_day` | time_bucket, mode | short car trips 8-9am |
| `energy_time_of_day` | time_bucket, appliance_category | AC heavy after 10pm |
| `shopping_periodic` | period_position (e.g. "first weekend of month"), category | monthly shopping spike |
| `waste_category` | category, frequency | high packaging waste weekly |
| `recommendation_response` | category, action_type | user always dismisses transport recs |

### 1.4 Behaviour mining pseudocode

```python
def mine_patterns(user_id, lookback_days=56):
    activities = fetch_activities(user_id, since=today - lookback_days)
    candidate_dimensions = generate_dimension_combinations(activities)
    # e.g. groups by (day_of_week, category), (time_bucket, mode), etc.

    patterns = []
    for dims in candidate_dimensions:
        matches = filter_activities(activities, dims)
        opportunities = count_eligible_days(dims, lookback_days)
        if opportunities == 0:
            continue

        base_rate = len(matches) / opportunities
        recency = exponential_decay(days_since(matches[-1].date), half_life=21)
        consistency = 1 - coefficient_of_variation(inter_arrival_gaps(matches))
        confidence = clamp(base_rate * recency * consistency, 0, 1)

        if confidence >= MIN_STORE_THRESHOLD:  # 0.35
            patterns.append(Pattern(user_id, dims, len(matches), confidence, ...))

    upsert_patterns(patterns)  # merge with existing, update trend
    return patterns
```

Also mined: **feedback patterns** — e.g. "user has rejected 3 of the last 3 transport recommendations" — these feed directly into the fatigue/suppression logic (Section 4) rather than into carbon-savings rules.

---

## 2. Carbon Estimation

> **Integration boundary:** the formulas below describe what the **external Carbon Calculation Service** computes (see `01-overview-and-architecture.md` §3). The recommendation engine (candidate generation, scoring, ranking, explanation) never performs this arithmetic itself — it calls that service via `CarbonCalculationClient.estimate(...)` (see `engine/recommendation_engine.py`) and only ever consumes the returned `co2e_kg` figure. Everything downstream of that call (`saved_kg_co2e = baseline.co2e_kg - recommended.co2e_kg`) is a difference/percentage of numbers the external service already produced, not a re-derivation from a raw factor value.

### 2.1 Core formula (as computed by the external Carbon Calculation Service)

```
Saved_CO2e = Baseline_Emissions - Recommended_Emissions

Baseline_Emissions    = quantity_baseline * emission_factor(baseline_activity, factor_version)
Recommended_Emissions = quantity_recommended * emission_factor(recommended_activity, factor_version)

Percentage_Reduction  = Saved_CO2e / Baseline_Emissions * 100
```

Every emission factor lookup returns `{value, unit, source, version, published_date}` — this tuple is stored alongside the recommendation, not just the final number, so any historical recommendation can be audited against the exact factor used at the time (factors get revised yearly; old recommendations shouldn't silently "change" their stated savings).

### 2.2 Worked example (matches the spec's own example)

```
User: eats ~350g chicken curry on Thursdays, 4 of last 5 weeks (confidence 0.78)
Baseline: 350g chicken (cooked, curry-style)
  emission_factor(chicken, cooked) = 6.9 kg CO2e / kg   [source: OWID/Poore&Nemecek 2021, v3]
  Baseline_Emissions = 0.35kg * 6.9 = 2.415 kg CO2e

Recommended: 350g paneer (equivalent dish)
  emission_factor(paneer, cooked) = 0.9 kg CO2e / kg    [source: same dataset, v3]
  Recommended_Emissions = 0.35kg * 0.9 = 0.315 kg CO2e

Saved_CO2e = 2.415 - 0.315 = 2.1 kg CO2e   ✓ matches spec example
Percentage_Reduction = 2.1 / 2.415 * 100 = 87%
```

(Note: the spec's own example states "58%" for this swap — the exact percentage depends on which emission-factor dataset and portion assumptions are used. This is precisely why **factor source + version is always stored**: the number is only ever as good as its cited source, and different licensed providers will yield different — both defensible — percentages. The system should never claim a percentage without being able to show its factor citation.)

### 2.3 Confidence / uncertainty on the estimate itself

Two independent confidence numbers exist and must not be conflated:

- **Pattern confidence** — how sure we are the user actually behaves this way (Section 1.2)
- **Estimate confidence** — how sure we are the kg CO₂e number is accurate, driven by:
  - specificity of quantity data (user-logged portion size vs. assumed default portion)
  - emission factor granularity (region-specific factor vs. global average)
  - recency of the emission factor version

```
estimate_confidence = factor_specificity_score * quantity_specificity_score
```

Both confidences are combined multiplicatively into the final recommendation's displayed `confidence` field (Section 5), but stored separately in the reasoning trace for debugging/audit.

### 2.4 Time-horizon projections

```
daily_saving   = Saved_CO2e                                  # single instance
weekly_saving  = daily_saving * expected_occurrences_per_week  # from pattern occurrence rate
monthly_saving = weekly_saving * 4.345
yearly_saving  = weekly_saving * 52
```

`expected_occurrences_per_week` comes directly from the mined pattern's `base_rate` (Section 1.2) — e.g. if the user eats chicken on 4 of ~4.3 Thursdays/month, weekly occurrence ≈ 0.93, so weekly_saving ≈ 0.93 × 2.1kg ≈ 1.95kg. This is why the spec's "projected monthly reduction: 6.4 kg CO₂e" style claims are always **habit-frequency-adjusted**, not naive daily×30 multiplication (which would overstate a once-a-week habit by 4-7x).

---

## 3. Multi-Objective Scoring Framework

### 3.1 Score components

Each candidate recommendation `r` gets a composite score:

```
Score(r) =
      w1 * norm(carbon_savings)
    + w2 * acceptance_probability
    + w3 * pattern_confidence
    + w4 * context_relevance
    + w5 * preference_fit
    + w6 * (1 - convenience_cost)
    + w7 * category_priority_weight
    - w8 * fatigue_penalty
    - w9 * repetition_penalty
```

Default weights (tunable per user via A/B, and adjustable by user goal setting — e.g. a user whose goal is "save money" gets `w6` boosted):

| Component | Weight | Notes |
|---|---|---|
| `carbon_savings` (normalised 0-1 vs. user's typical category emissions) | 0.25 | The single largest factor, but capped — a huge saving with near-zero acceptance probability still loses |
| `acceptance_probability` | 0.20 | See 3.2 |
| `pattern_confidence` | 0.15 | Low-confidence patterns get down-weighted even if the theoretical saving is large |
| `context_relevance` | 0.12 | Is *today* actually the right day/time for this? |
| `preference_fit` | 0.10 | Respects diet, mobility constraints, disabled categories |
| `1 - convenience_cost` | 0.10 | Easy actions preferred at equal savings |
| `category_priority_weight` | 0.08 | From user's stated goal (e.g. "transport focus") |
| `fatigue_penalty` | subtractive | See Section 4 |
| `repetition_penalty` | subtractive | See Section 4 |

### 3.2 Acceptance probability estimation (V1, non-ML)

```
acceptance_probability =
    base_rate_for_category(user)      # this user's historical accept rate for this category
    * recency_adjustment              # more weight to recent feedback than old
    * similarity_adjustment           # was a *similar* recommendation (not identical) accepted before?

# Cold start (no feedback history yet): use global priors, e.g.
#   food swaps: 0.42, transport mode change: 0.31, energy: 0.55, shopping: 0.22
# (illustrative priors — calibrate from pilot cohort data)
```

This is explicitly designed as the seam where a learned model (logistic regression → gradient boosted trees → eventually a lightweight neural ranker) slots in later without changing the rest of the scoring pipeline — see the ML Roadmap in Part 6.

### 3.3 Context relevance

Binary/graded checks per recommendation type:
- Food swap for "today's expected meal": 1.0 if pattern day matches today, decays if off-pattern day
- Transport: 1.0 if within commute time window, weather-compatible (e.g. cycling suggestion checks precipitation)
- Energy: time-of-day match (AC optimisation suggested near evening, not at 7am)

### 3.4 Threshold — when NOT to show a recommendation

```
MIN_DISPLAY_SCORE = 0.45          # candidates below this are discarded, not queued
MIN_CONFIDENCE_FOR_SPECIFIC_CLAIM = 0.5   # below this, fall back to hedged/generic copy
                                            # even if the underlying score qualifies
```

A candidate can score above 0.45 on convenience/relevance alone but if its *carbon estimate confidence* is very low, the copy generation step (Part 2 Section 5) is instructed to soften language ("may reduce" instead of "will reduce ~58%") rather than suppress it entirely — spec requires "small number of high-value recommendations," not zero recommendations when data is thin.

---

## 4. Anti-Spam, Cooldown & Fatigue System

```
Rules enforced at Ranking stage, in order:

1. FREQUENCY CAP
   max_recommendations_per_day = 3 (default, user-configurable down to 1)
   max_notifications_per_day   = 1 (in-app feed can show more; push notifications capped harder)

2. COOLDOWN PER RECOMMENDATION FINGERPRINT
   fingerprint = hash(user_id, recommendation_type, target_category, action)
   if fingerprint shown in last COOLDOWN_DAYS (default 3) → suppress
   if fingerprint REJECTED in last REJECTION_COOLDOWN_DAYS (default 14) → suppress,
       unless carbon_savings increased >20% since (e.g. new higher-impact variant)

3. CATEGORY BALANCING
   Do not show >1 recommendation from the same category in the same day's feed
   unless fewer than 2 total qualifying candidates exist across all categories

4. FATIGUE PENALTY (feeds into Score, not just a hard filter)
   fatigue_penalty = f(recent_ignore_rate, recent_dismiss_rate)
   # a user who has ignored/dismissed 4 of the last 5 recommendations gets a
   # rising penalty applied broadly, and triggers a "reduce frequency" flag
   # surfaced to Notification Service (auto-throttle, with an in-app setting
   # surfaced: "Show recommendations less often?")

5. REPETITION PENALTY
   Distinct from cooldown: even outside the cooldown window, repeatedly
   recommending very similar actions produces diminishing score, encouraging
   the candidate pool to surface variety (chicken→paneer one week,
   chicken→lentils the next, rather than the same swap every single Thursday)
```

Pseudocode for the filter pipeline:

```python
def rank_and_filter(candidates, user_id):
    scored = [score(c, user_id) for c in candidates]
    scored = [c for c in scored if c.score >= MIN_DISPLAY_SCORE]
    scored = apply_cooldown_suppression(scored, user_id)
    scored = apply_category_balancing(scored)
    scored.sort(key=lambda c: c.score, reverse=True)
    selected = scored[:max_recommendations_per_day(user_id)]
    return selected
```

---

## 5. Explainability System

### 5.1 Reasoning trace (stored, backend-only)

Every generated recommendation stores a full trace **before** any copy is generated:

```json
{
  "recommendation_id": "rec_8f2a...",
  "trigger": {
    "type": "pattern",                        // "pattern" | "rule" | "model"
    "pattern_id": "pat_44c1...",
    "pattern_summary": "chicken on Thursday, 4/5 weeks, confidence 0.78"
  },
  "carbon_calculation": {
    "baseline_activity": "chicken_curry_cooked",
    "baseline_quantity_kg": 0.35,
    "baseline_factor_id": "ef_chicken_v3",
    "baseline_emissions_kg": 2.415,
    "recommended_activity": "paneer_curry_cooked",
    "recommended_quantity_kg": 0.35,
    "recommended_factor_id": "ef_paneer_v3",
    "recommended_emissions_kg": 0.315,
    "saved_kg_co2e": 2.1,
    "percent_reduction": 87.0
  },
  "selection_reasoning": {
    "candidates_considered": ["chicken_to_paneer", "chicken_to_lentils", "skip_meat_day"],
    "selected": "chicken_to_paneer",
    "selection_reason": "highest combined score: savings=0.83, acceptance_prob=0.46 (user accepted similar swap twice), preference_fit=1.0 (no dietary conflict)",
    "score_breakdown": {"carbon": 0.83, "acceptance": 0.46, "pattern_confidence": 0.78, "context": 1.0, "preference_fit": 1.0, "convenience": 0.9}
  },
  "engine_version": "rules-v1.4"
}
```

### 5.2 Human-readable rendering (what the user sees)

A short template-driven (or LLM-polished) sentence built **only** from the trace above — never inventing facts not present in it:

```
Template: "You've eaten {baseline_food} on {pattern_day} for {occurrence_fraction} recent weeks.
           Swapping to {recommended_food} today could save about {saved_kg} kg CO2e ({percent}% less)."

Rendered: "You've eaten chicken on Thursday for 4 of the last 5 weeks. Swapping to paneer
           today could save about 2.1 kg CO2e (87% less)."
```

If an LLM is used to polish tone/variety, its system prompt is constrained to: *"Rewrite this factual sentence for warmth and brevity. Do not add, remove, or alter any number, food name, day, or percentage."* Output is validated post-hoc (regex/number-diff check against the trace) before display — if the LLM altered a number, fall back to the template render.

---

## 6. Feedback Loop

### 6.1 Feedback event types

| Event | Meaning | Effect |
|---|---|---|
| `accepted` | User tapped CTA ("I'll do this") | + acceptance_probability for this (user, category, action) pair; pattern confidence unaffected directly |
| `dismissed` | User explicitly dismissed/"not for me" | − acceptance_probability; triggers cooldown; if repeated 3x for a category → soft-suppress category for 30 days |
| `ignored` | Shown, no interaction within TTL (e.g. 48h) | Small − acceptance_probability; weighted less than explicit dismissal (avoids over-penalising simple inattention) |
| `partially_completed` | User marked "did something similar" | Neutral-positive; logged for analytics, small + to acceptance_probability |
| `behaviour_confirmed` | Follow-up check: did the pattern actually not recur? (e.g. no chicken logged next Thursday) | Strongest positive signal; boosts both acceptance_probability and the specific rule's long-term efficacy score |
| `behaviour_unchanged` | Pattern recurred despite acceptance | Flags possible "social desirability" acceptance (user taps yes but doesn't follow through) — down-weights that user's `accepted` events slightly for future probability calc |

### 6.2 Update pseudocode

```python
def process_feedback(event):
    save_feedback_event(event)  # always, unconditionally, for audit/analytics

    key = (event.user_id, event.category, event.action_type)
    prob = get_acceptance_probability(key)

    delta = FEEDBACK_DELTA[event.type]   # e.g. accepted: +0.08, dismissed: -0.12, ignored: -0.03
    new_prob = clamp(prob + delta * recency_weight(event), 0.02, 0.98)
    update_acceptance_probability(key, new_prob)

    if event.type == "dismissed":
        increment_cooldown(fingerprint(event))
    if consecutive_dismissals(event.user_id, event.category) >= 3:
        soft_suppress_category(event.user_id, event.category, days=30)

    # asynchronously, days later:
    schedule_behaviour_confirmation_check(event)
```

### 6.3 What feedback improves (explicit mapping back to spec requirements)

- **Ranking** → via `acceptance_probability` updates (Section 3.2)
- **Repeated bad suggestions reduced** → via cooldown + soft-suppression (Section 4)
- **Personalisation** → `preference_fit` learns implicit constraints (e.g. repeated dismissal of all beef-related suggestions → inferred as a soft "reduce beef suggestions" preference even without explicit setting)
- **Fatigue identification** → Section 4.4
- **Difficulty adaptation** → if `easy`-labelled recommendations are dismissed but `moderate` ones accepted, difficulty-tier preference shifts
- **Confidence refinement** → `behaviour_confirmed`/`behaviour_unchanged` events feed back into the **rule's own historical efficacy**, stored per rule (e.g. "chicken→paneer swap has an 71% real-world follow-through rate across all users who accepted it" — a global rule-quality signal, distinct from any one user's pattern confidence)

---

*Continued in Part 3: Database Schema (see `03-database-schema.sql`), Part 4: API Design.*
