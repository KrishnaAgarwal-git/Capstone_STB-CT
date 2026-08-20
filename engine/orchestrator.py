"""
Orchestration layer — wires the pipeline together end to end
==============================================================

    User Activity Data
        |
        v
    Carbon Calculation Client   <-- swap MockCarbonCalculationClient for
        |                           HttpCarbonCalculationClient here; see
        |                           "SWAPPING IN YOUR REAL CALCULATOR" below
        v
    Recommendation Engine (recommendation_engine.py -- UNCHANGED by this file)
        |
        v
    Notification-shaped output  <-- what a frontend/push-notification layer
                                     renders on the user's device

`recommendation_engine.py` deliberately has no knowledge of activity storage,
HTTP, or notification formatting -- it's a pure function of (activities,
patterns, context) -> ranked candidates. This file is the thin, swappable
seam around it. Nothing in this file duplicates or reimplements any
scoring/mining/ranking logic -- it only calls the engine's existing public
functions in the right order and reshapes the result.

("UNCHANGED by this file" above means exactly that: orchestrator.py never
edits recommendation_engine.py's source. recommendation_engine.py itself HAS
grown additively over this project's life -- generate_candidates_from_selections()
for the knowledge-base candidate path, and an optional LinUCB blend inside
score_candidate() -- but always as new, backward-compatible capability, never
as a rewrite of what already worked. See RECOMMENDATION_ENGINE.md for the
full picture of what's live today.)

================================================================================
SWAPPING IN YOUR REAL CALCULATOR
================================================================================
Everywhere below, `carbon_client` is typed as `CarbonCalculationClient` (the
Protocol already defined in recommendation_engine.py). Three implementations
satisfy it:

  1. MockCarbonCalculationClient (this file)   -- fake numbers, for the demo UI
  2. InMemoryCarbonCalculationClient (engine)  -- what the test suite uses
  3. HttpCarbonCalculationClient (engine)      -- calls a real external service

To go from this demo to your real Carbon Calculator, you do NOT edit this
file's logic. You change exactly one line wherever a client is constructed
(see `build_demo_client()` at the bottom of this file, and `demo_server.py`):

    carbon_client = MockCarbonCalculationClient()
    # becomes:
    carbon_client = HttpCarbonCalculationClient(base_url="https://your-carbon-calculator.example.com")

HttpCarbonCalculationClient (already implemented in recommendation_engine.py)
expects your calculator to expose:

    POST {base_url}/api/v1/recommendations/preview
    body: {"baseline_activity": str, "baseline_quantity": float, "unit": str,
           "region_code": str, "candidate_alternatives": []}
    response JSON: {"baseline_emissions_kg": float,
                     "emission_factor": {"unit": str, "source": str, "version": str},
                     "calculation_confidence": float}

If your real calculator's endpoint/response shape differs, the fix belongs in
a new class implementing CarbonCalculationClient (copy HttpCarbonCalculationClient
as a starting point) -- never in generate_candidates(), score_candidate(), or
anything else downstream. That boundary is what makes this swap small.
================================================================================
"""

from __future__ import annotations

import random
from dataclasses import dataclass, asdict
from datetime import datetime, date, timedelta
from typing import Optional

from recommendation_engine import (
    Activity, Category,
    CarbonEstimate, EmissionFactor, CarbonCalculationClient,
    BehaviourPattern, UserContext, RecommendationCandidate, FeedbackEvent, FeedbackType,
    mine_pattern, generate_candidates_from_selections,
    rank_and_filter, render_explanation_text,
    project_savings, aggregate_user_carbon_baseline, process_feedback,
)
import knowledge_base
import profile_confidence
import reward_mapping
from dynamic_candidate_generator import generate_dynamic_candidates
from linucb import LinUCB
from linucb_features import FEATURE_NAMES, build_context_vector


# ------------------------------------------------------------------------
# 1. Mock Carbon Calculator
#    Implements the SAME CarbonCalculationClient protocol as the real
#    HTTP client -- see the module docstring above for what changes (one
#    line, at the call site) when a real calculator is ready.
# ------------------------------------------------------------------------

# Illustrative, not authoritative, factors -- fine for a UI demo, wrong for
# production. Your real Carbon Calculator is the source of truth for these;
# this table exists only so the demo runs with zero external dependencies.
_MOCK_FACTORS = {
    # (activity_key, region_code): (kg_co2e_per_unit, source_label, unit)
    ("chicken_curry_cooked", "GLOBAL"): (6.9, "MOCK_DATA", "kg_co2e_per_kg"),
    ("paneer_curry_cooked", "GLOBAL"): (0.9, "MOCK_DATA", "kg_co2e_per_kg"),
    ("lentil_curry_cooked", "GLOBAL"): (0.5, "MOCK_DATA", "kg_co2e_per_kg"),
    ("car_solo_commute", "GLOBAL"): (0.192, "MOCK_DATA", "kg_co2e_per_km"),
    ("car_carpool_commute", "GLOBAL"): (0.096, "MOCK_DATA", "kg_co2e_per_km"),
    ("two_wheeler_solo_commute", "GLOBAL"): (0.103, "MOCK_DATA", "kg_co2e_per_km"),
    ("auto_rickshaw_commute", "GLOBAL"): (0.14, "MOCK_DATA", "kg_co2e_per_km"),
    ("bus_commute", "GLOBAL"): (0.089, "MOCK_DATA", "kg_co2e_per_km"),
    ("metro_commute", "GLOBAL"): (0.041, "MOCK_DATA", "kg_co2e_per_km"),
    ("ev_solo_commute", "GLOBAL"): (0.053, "MOCK_DATA", "kg_co2e_per_km"),
    ("ev_solo_commute", "IN_PUNJAB"): (0.028, "MOCK_DATA", "kg_co2e_per_km"),
    ("ev_solo_commute", "IN_COAL_HEAVY"): (0.071, "MOCK_DATA", "kg_co2e_per_km"),
    ("standby_power_overnight", "GLOBAL"): (0.4, "MOCK_DATA", "kg_co2e_per_kwh"),
    ("devices_off_overnight", "GLOBAL"): (0.0, "MOCK_DATA", "kg_co2e_per_kwh"),
    ("single_use_plastic_bottle", "GLOBAL"): (0.08, "MOCK_DATA", "kg_co2e_per_item"),
    ("reusable_bottle_use", "GLOBAL"): (0.0, "MOCK_DATA", "kg_co2e_per_item"),
}

# The 104-entry knowledge base (recommendations_data.py) references ~200
# distinct activity keys across ~40 different units ("balloon", "napkin",
# "diaper", ...) -- far more than the curated table above covers, by design
# (that table exists only to demo the original 10-rule RULE_LIBRARY). Rather
# than hand-inventing ~180 more specific-looking mock numbers (which would
# look more authoritative than a demo table should), unknown activity keys
# fall back to one flat illustrative factor per Category, so the demo
# pipeline can actually show 104-entry-driven output end to end. Every
# fallback estimate is labelled "MOCK_DATA_CATEGORY_FALLBACK" -- even more
# clearly non-authoritative than the curated table's "MOCK_DATA" -- and a
# real Carbon Calculation Service replaces this whole class, fallback
# included (see module docstring, "SWAPPING IN YOUR REAL CALCULATOR").
_CATEGORY_FALLBACK_FACTOR = {
    Category.FOOD: 0.8,
    Category.TRANSPORT: 0.15,
    Category.ELECTRICITY: 0.35,
    Category.WATER: 0.2,
    Category.SHOPPING: 0.5,
    Category.WASTE: 0.25,
    Category.LIFESTYLE: 0.3,
}

# Built once from the knowledge base so the fallback above can be looked up
# by activity_key (the only thing CarbonCalculationClient.estimate receives)
# -- not a duplicate of knowledge_base's own data, just an activity_key ->
# category index over it, for this mock client's use only.
_ACTIVITY_KEY_TO_CATEGORY: dict[str, Category] = {}
for _definition in knowledge_base.all_recommendations():
    _ACTIVITY_KEY_TO_CATEGORY.setdefault(_definition.baseline_activity_key, _definition.category)
    _ACTIVITY_KEY_TO_CATEGORY.setdefault(_definition.recommended_activity_key, _definition.category)


class MockCarbonCalculationClient:
    """Fake stand-in for the real Carbon Calculator, satisfying the exact
    same CarbonCalculationClient protocol as HttpCarbonCalculationClient.
    Clearly labelled MOCK_DATA in every returned estimate so it's never
    mistaken for a real number in a screenshot or a demo. No network calls,
    no dependencies -- safe to run anywhere."""

    def estimate(self, activity_key: str, quantity: float, unit: str,
                 region_code: str = "GLOBAL") -> CarbonEstimate:
        key = (activity_key, region_code)
        if key not in _MOCK_FACTORS:
            key = (activity_key, "GLOBAL")
        if key in _MOCK_FACTORS:
            value_per_unit, source, factor_unit = _MOCK_FACTORS[key]
        else:
            # Not in the curated table -- fall back to a flat per-category
            # illustrative factor (see _CATEGORY_FALLBACK_FACTOR above) so the
            # 104-entry knowledge base has *something* to price against in
            # this demo. Still raises KeyError, same as before, for an
            # activity_key this mock client has no category for at all.
            category = _ACTIVITY_KEY_TO_CATEGORY.get(activity_key)
            if category is None:
                raise KeyError(
                    f"[MOCK] No mock factor or category fallback for '{activity_key}' "
                    f"(region '{region_code}' or GLOBAL). This is expected for activity "
                    f"keys your real Carbon Calculator would recognise but this demo "
                    f"table/knowledge base doesn't cover."
                )
            value_per_unit = _CATEGORY_FALLBACK_FACTOR.get(category, 0.3)
            source, factor_unit = "MOCK_DATA_CATEGORY_FALLBACK", f"kg_co2e_per_{unit}"
        co2e_kg = round(quantity * value_per_unit, 4)
        factor = EmissionFactor(
            factor_key=activity_key, unit=factor_unit, source=source,
            version="mock-v1", region_code=region_code,
        )
        return CarbonEstimate(
            activity_key=activity_key, quantity=quantity, unit=unit,
            co2e_kg=co2e_kg, emission_factor=factor, calculation_confidence=0.9,
        )


# ------------------------------------------------------------------------
# 2. Notification-shaped output
#    What a frontend / push-notification layer actually needs -- flatter
#    and smaller than RecommendationCandidate, which carries internal
#    scoring/audit detail a notification UI shouldn't have to unpack.
# ------------------------------------------------------------------------

@dataclass
class RecommendationNotification:
    """One recommendation, shaped for display as a notification/card on the
    user's device main page. Deliberately flat (no nested objects) so it
    serializes straight to JSON for any frontend, not just this demo UI."""
    id: str
    category: str
    title: str
    body: str                    # the human-readable explanation (render_explanation_text)
    saved_kg_co2e: float
    percent_reduction: float
    difficulty: str
    tradeoff_note: Optional[str]
    confidence: float            # estimate_confidence, post-scoring
    score: float                 # final_score, for a caller that wants to sort/filter further
    weekly_kg_projection: float
    monthly_kg_projection: float

    def to_dict(self) -> dict:
        return asdict(self)


def _to_notification(candidate: RecommendationCandidate) -> RecommendationNotification:
    """Reshape one scored RecommendationCandidate into the flat notification
    shape above. Pure reshaping -- reads fields already computed by the
    engine (score_candidate, render_explanation_text, project_savings),
    computes nothing new."""
    projection = project_savings(candidate)
    return RecommendationNotification(
        id=candidate.id,
        category=candidate.category.value,
        title=candidate.title,
        body=render_explanation_text(candidate),
        saved_kg_co2e=candidate.saved_kg_co2e,
        percent_reduction=candidate.percent_reduction,
        difficulty=candidate.difficulty.value,
        tradeoff_note=candidate.tradeoff_note,
        confidence=candidate.estimate_confidence,
        score=candidate.score_breakdown.final_score if candidate.score_breakdown else 0.0,
        weekly_kg_projection=projection.weekly_kg,
        monthly_kg_projection=projection.monthly_kg,
    )


# ------------------------------------------------------------------------
# 3. The orchestration function itself
#    This is the piece that didn't exist in the engine file by design (see
#    the prior audit) -- recommendation_engine.py exposes the building
#    blocks, this function calls them in the right order.
# ------------------------------------------------------------------------

# Which pattern types the mining step looks for, and how to recognise a
# matching activity for each -- this mirrors the pattern_types already
# referenced by RULE_LIBRARY inside recommendation_engine.py (see
# applicable_pattern_types on each SwapRule). Kept here, not in the engine
# file, because "how raw activities map to mineable pattern dimensions" is
# an ingestion-layer concern, not the engine's -- the engine only ever
# consumes already-mined BehaviourPattern objects.
_PATTERN_RULES = [
    # (pattern_type, matches(activity) -> bool, dimensions(activity) -> dict)
    ("meal_day_of_week",
     lambda a: a.category == Category.FOOD and "chicken" in a.subtype,
     lambda a: {"day_of_week": a.occurred_at.weekday(), "food_category": "chicken"}),
    ("transport_weekday",
     lambda a: a.category == Category.TRANSPORT and a.subtype == "car_solo_commute"
               and a.occurred_at.weekday() < 5,
     lambda a: {"day_of_week": a.occurred_at.weekday()}),
    ("energy_time_of_day",
     lambda a: a.category == Category.ELECTRICITY and a.subtype == "standby_power_overnight",
     lambda a: {"time_of_day": "overnight"}),
]


def mine_patterns_from_activities(
    activities: list[Activity],
    as_of: datetime,
    window_days: int = 60,
) -> list[BehaviourPattern]:
    """
    Group raw activities by the pattern types the rule library knows about
    (_PATTERN_RULES above), then call the engine's own mine_pattern() once
    per dimension-combination found. This is the ingestion-side counterpart
    to mine_pattern() -- it decides WHICH (pattern_type, dimensions) pairs
    are worth asking the engine to score, the engine still does 100% of the
    actual confidence math (mine_pattern is untouched, imported directly).

    eligible_opportunities is estimated as "how many days in the window
    could this dimension combination plausibly have occurred on" -- 1/7th
    of window_days for a specific weekday, or window_days itself for a
    daily-eligible pattern (like standby power, which can happen any night).
    A production ingestion layer likely has a more precise opportunity
    count (e.g. from a calendar/schedule); this is a reasonable default for
    a demo with no such source.
    """
    cutoff = as_of - timedelta(days=window_days)
    recent = [a for a in activities if a.occurred_at >= cutoff]

    patterns: list[BehaviourPattern] = []
    for pattern_type, matches, dims_fn in _PATTERN_RULES:
        matching = [a for a in recent if matches(a)]
        if not matching:
            continue
        # group further by the actual dimensions (e.g. two different
        # weekdays of car commuting are two separate patterns, not one)
        by_dims: dict = {}
        for a in matching:
            key = tuple(sorted(dims_fn(a).items()))
            by_dims.setdefault(key, []).append(a)

        for dims_key, acts in by_dims.items():
            dims = dict(dims_key)
            if "day_of_week" in dims:
                eligible_opportunities = max(1, round(window_days / 7))
            else:
                eligible_opportunities = window_days
            pattern = mine_pattern(
                user_id=acts[0].user_id, pattern_type=pattern_type, dimensions=dims,
                matching_activities=acts, eligible_opportunities=eligible_opportunities,
                as_of=as_of,
            )
            if pattern is not None:
                patterns.append(pattern)
    return patterns


def build_demo_linucb_model() -> LinUCB:
    """One place that decides the live pipeline's LinUCB hyperparameters --
    n_features from linucb_features.FEATURE_NAMES (so a future change to the
    feature adapter's vector length can't silently desync from the model),
    alpha from reward_mapping.RECOMMENDED_ALPHA (the empirically calibrated
    value -- see reward_mapping.py). Mirrors build_demo_client()'s role for
    the carbon client: the one call site a caller swaps to inject a
    persisted/pre-trained model instead of a fresh one."""
    return LinUCB(n_features=len(FEATURE_NAMES), alpha=reward_mapping.RECOMMENDED_ALPHA)


def _attach_linucb_scores(
    candidates: list[RecommendationCandidate],
    selections: list,
    profile: profile_confidence.DataConfidenceProfile,
    ctx: UserContext,
    linucb_model: LinUCB,
) -> dict[str, list[float]]:
    """Score every candidate that came from the dynamic candidate generator
    (i.e. has a knowledge_base_definition_id) against `linucb_model`, and
    mutate candidate.linucb_score in place -- see score_candidate()'s "LinUCB
    blend" section in recommendation_engine.py for how that score then
    participates in ranking (blended, not a replacement).

    Read-only with respect to `linucb_model` (only score_arm(), never
    update()) -- learning happens later, when real feedback arrives (see
    InMemoryUserStore.record_feedback()).

    Returns {candidate.id: context_vector} for every candidate a score was
    attached to, so a caller that goes on to show these candidates to a user
    can remember exactly which context vector produced each shown score, for
    an accurate LinUCB.update() call once feedback comes back (recomputing
    the vector later could silently drift from what was actually scored/shown,
    e.g. if the user's profile changes in between).
    """
    selection_by_definition_id = {s.definition.id: s for s in selections}
    context_vectors_by_candidate_id: dict[str, list[float]] = {}
    for candidate in candidates:
        if candidate.knowledge_base_definition_id is None:
            continue
        selection = selection_by_definition_id.get(candidate.knowledge_base_definition_id)
        if selection is None:
            continue
        vector = build_context_vector(ctx, profile, selection)
        candidate.linucb_score = linucb_model.score_arm(candidate.knowledge_base_definition_id, vector)
        context_vectors_by_candidate_id[candidate.id] = vector
    return context_vectors_by_candidate_id


def get_recommendations(
    user_id: str,
    activities: list[Activity],
    carbon_client: CarbonCalculationClient,
    account_age_days: int,
    ctx: Optional[UserContext] = None,
    region_code: str = "GLOBAL",
    today: Optional[date] = None,
    max_per_day: int = 3,
    linucb_model: Optional[LinUCB] = None,
) -> list[RecommendationNotification]:
    """
    The full pipeline, start to finish:

        activities  --[mine_patterns_from_activities]-->  patterns
        activities  --[aggregate_user_carbon_baseline]-->  carbon baseline
        activities  --[profile_confidence.compute_data_confidence]-->  DataConfidenceProfile
        patterns + profile + knowledge_base  --[generate_dynamic_candidates]-->  CandidateSelections
        selections + carbon_client  --[generate_candidates_from_selections]-->  candidates
        candidates + ctx  --[rank_and_filter]-->  selected (scored, ranked, filtered)
        selected  --[_to_notification]-->  notification-shaped output

    Every arrow above is an existing function from recommendation_engine.py,
    profile_confidence.py, dynamic_candidate_generator.py, or knowledge_base.py
    (all untouched in their own logic) except the ingestion-side helper this
    file adds (mine_patterns_from_activities). This function does not
    reimplement mining, tier-gating, scoring, or ranking -- it only sequences
    existing pieces in the right order.

    Candidate SOURCE: the 104-entry knowledge base (knowledge_base.py /
    recommendations_data.py), filtered per-user by generate_dynamic_candidates()
    -- NOT the smaller static RULE_LIBRARY (recommendation_engine.generate_candidates()
    is retained for its own test suite / as a reference implementation, but is
    no longer what this live pipeline calls).

    Personalization tier: gated by profile.confidence_tier, which
    compute_data_confidence derives purely from the activities list (volume,
    spread, recency) -- NEVER from account_age_days. `account_age_days` is
    accepted here only for API/signature compatibility with existing callers
    (e.g. so a caller can still log/display "how old is this account"); it is
    not read anywhere in this function's candidate-generation or
    personalization logic.

    If `ctx` is not supplied, a neutral default UserContext is built (no
    feedback history yet, no peer group, no dietary constraints) -- the
    right starting point for a brand-new user. Once real feedback/peer data
    exists, callers should build and pass their own UserContext instead
    (see FeedbackStore below for how accepted/dismissed history should feed
    back into one across calls).

    `linucb_model`: optional. If supplied, every candidate's linucb_score is
    computed (read-only -- see _attach_linucb_scores) and blended into its
    final_score by score_candidate() (BLEND_WEIGHT_LINUCB, in
    recommendation_engine.py). If None (the default), this function's output
    is byte-for-byte identical to before LinUCB existed -- this is a stateless
    reference function with no feedback loop of its own, so it has nowhere to
    persist a model across calls anyway; InMemoryUserStore below is the
    stateful path that actually learns from feedback over time.
    """
    as_of = datetime.combine(today, datetime.min.time()) if today else datetime.now()
    today = today or as_of.date()

    patterns = mine_patterns_from_activities(activities, as_of=as_of)
    baseline = aggregate_user_carbon_baseline(activities, carbon_client, region_code=region_code, as_of=as_of)

    if ctx is None:
        ctx = UserContext(
            user_id=user_id,
            category_acceptance_rate={},
            category_priority_weight={},
            disabled_categories=set(),
            dietary_constraints=set(),
            fatigue_level=0.0,
            recent_action_fingerprints={},
            recent_rejected_fingerprints={},
            category_avg_daily_kg=baseline,
        )
    else:
        # keep the freshly-computed baseline in sync even if a caller passed
        # their own ctx (e.g. one carried across calls for feedback history)
        ctx.category_avg_daily_kg = baseline

    profile = profile_confidence.compute_data_confidence(user_id, activities, as_of)
    selections = generate_dynamic_candidates(
        user_id, knowledge_base.all_recommendations(), patterns, profile,
        max_per_category=8,
    )
    candidates = generate_candidates_from_selections(
        user_id=user_id, selections=selections, carbon_client=carbon_client,
        region_code=region_code,
    )
    if linucb_model is not None:
        _attach_linucb_scores(candidates, selections, profile, ctx, linucb_model)
    selected = rank_and_filter(candidates, ctx, today, max_per_day=max_per_day)
    return [_to_notification(c) for c in selected]


# ------------------------------------------------------------------------
# 4. Minimal per-user feedback + activity store
#    Not a database -- an in-memory stand-in so the demo UI can show the
#    feedback loop (accept/dismiss actually changing future
#    recommendations) without you standing up Postgres first. Swap this
#    for real persistence (see `03-database-schema.sql`'s users/activities/
#    feedback_events tables) when you're ready; nothing in
#    get_recommendations() above depends on this class existing.
# ------------------------------------------------------------------------

class InMemoryUserStore:
    """Keyed by user_id. Holds activities, account creation time, and the
    UserContext that accumulates feedback across calls -- so accepting or
    dismissing a recommendation in the demo UI visibly changes what's
    recommended next, the same way it would with real persistence.

    Also holds ONE LinUCB model, shared across every user this store knows
    about (arms are knowledge-base definition ids, not per-user -- see
    linucb_features.py's module docstring: personalization comes from the
    per-round CONTEXT vector, not from having a separate model per user).
    This is the stateful path that actually learns from feedback over time;
    the module-level get_recommendations() function above is a stateless
    reference API with no feedback loop of its own."""

    def __init__(self, linucb_model: Optional[LinUCB] = None):
        self._activities: dict[str, list[Activity]] = {}
        self._created_at: dict[str, datetime] = {}
        self._ctx: dict[str, UserContext] = {}
        self._dismissal_streak: dict[str, dict[Category, int]] = {}
        # track exactly what was last shown, so an accept/dismiss event
        # (which only knows a notification id) can recover the full
        # RecommendationCandidate the engine needs for process_feedback
        self._last_candidates: dict[str, dict[str, RecommendationCandidate]] = {}
        # track exactly which LinUCB context vector produced each shown
        # candidate's linucb_score, so record_feedback() can call
        # LinUCB.update() with the SAME vector that was scored/shown --
        # recomputing it later from the user's now-current profile/patterns
        # could silently drift from what the user actually saw.
        self._last_linucb_context: dict[str, dict[str, list[float]]] = {}
        self._linucb_model = linucb_model if linucb_model is not None else build_demo_linucb_model()

    def ensure_user(self, user_id: str, account_age_days: int = 0):
        if user_id not in self._created_at:
            self._created_at[user_id] = datetime.now() - timedelta(days=account_age_days)
            self._activities[user_id] = []
            self._ctx[user_id] = UserContext(
                user_id=user_id, category_acceptance_rate={}, category_priority_weight={},
                disabled_categories=set(), dietary_constraints=set(), fatigue_level=0.0,
                recent_action_fingerprints={}, recent_rejected_fingerprints={},
                category_avg_daily_kg={},
            )
            self._dismissal_streak[user_id] = {}
            self._last_candidates[user_id] = {}
            self._last_linucb_context[user_id] = {}

    def account_age_days(self, user_id: str) -> int:
        return (datetime.now() - self._created_at[user_id]).days

    def add_activity(self, user_id: str, activity: Activity):
        self._activities[user_id].append(activity)

    def get_activities(self, user_id: str) -> list[Activity]:
        return list(self._activities[user_id])

    def get_context(self, user_id: str) -> UserContext:
        return self._ctx[user_id]

    def get_recommendations(
        self, user_id: str, carbon_client: CarbonCalculationClient,
        region_code: str = "GLOBAL",
    ) -> list[RecommendationNotification]:
        # NOTE: self.account_age_days(user_id) is deliberately NOT read here --
        # personalization tier comes entirely from profile_confidence, which
        # only ever looks at `activities` (see get_recommendations()'s
        # docstring above for the full rationale). account_age_days() remains
        # available on this store purely for display/bookkeeping (e.g. the
        # demo UI's "days since signup" label).
        as_of = datetime.now()
        activities = self.get_activities(user_id)
        patterns = mine_patterns_from_activities(activities, as_of=as_of)
        baseline = aggregate_user_carbon_baseline(activities, carbon_client, region_code=region_code, as_of=as_of)
        ctx = self.get_context(user_id)
        ctx.category_avg_daily_kg = baseline

        profile = profile_confidence.compute_data_confidence(user_id, activities, as_of)
        selections = generate_dynamic_candidates(
            user_id, knowledge_base.all_recommendations(), patterns, profile,
            max_per_category=8,
        )
        candidates = generate_candidates_from_selections(
            user_id=user_id, selections=selections, carbon_client=carbon_client,
            region_code=region_code,
        )
        context_vectors_by_candidate_id = _attach_linucb_scores(
            candidates, selections, profile, ctx, self._linucb_model,
        )
        selected = rank_and_filter(candidates, ctx, as_of.date())

        # remember candidates by id so a later accept/dismiss call (which
        # only has the notification id) can find the matching engine object
        self._last_candidates[user_id] = {c.id: c for c in selected}
        # ...and remember the exact LinUCB context vector each shown
        # candidate was scored with, keyed the same way, for record_feedback()
        self._last_linucb_context[user_id] = {
            c.id: context_vectors_by_candidate_id[c.id]
            for c in selected if c.id in context_vectors_by_candidate_id
        }
        return [_to_notification(c) for c in selected]

    def record_feedback(self, user_id: str, notification_id: str, event_type: FeedbackType):
        candidate = self._last_candidates.get(user_id, {}).get(notification_id)
        if candidate is None:
            raise KeyError(
                f"No recently-shown recommendation with id={notification_id} for user "
                f"{user_id} -- feedback must reference a notification from the most "
                f"recent get_recommendations() call for this user."
            )
        event = FeedbackEvent(
            user_id=user_id, recommendation_id=candidate.id, category=candidate.category,
            action_type=candidate.action_type, event_type=event_type, occurred_at=datetime.now(),
        )
        process_feedback(
            event, self.get_context(user_id),
            consecutive_dismissals_by_category=self._dismissal_streak[user_id],
        )

        # Second, independent consumer of the same event (see reward_mapping.py's
        # module docstring) -- does NOT affect/replace process_feedback() above.
        # Only fires when this candidate actually had a LinUCB score attached
        # (i.e. it came from the dynamic candidate generator and a context
        # vector was remembered for it); silently no-ops otherwise rather than
        # raising, since a candidate without LinUCB involvement is a normal,
        # expected case (e.g. the RULE_LIBRARY reference path), not an error.
        context_vector = self._last_linucb_context.get(user_id, {}).get(notification_id)
        if candidate.knowledge_base_definition_id is not None and context_vector is not None:
            reward = reward_mapping.reward_for_feedback_event(event)
            self._linucb_model.update(candidate.knowledge_base_definition_id, context_vector, reward)


# ------------------------------------------------------------------------
# 5. Realistic activity seeding, for the demo UI only
#    Generates a plausible activity history so "New demo user" -> mature
#    user actually has patterns to mine, without requiring you to hand-type
#    activities through the UI first. Not part of the pipeline itself.
# ------------------------------------------------------------------------

def seed_demo_activities(user_id: str, account_age_days: int, rng_seed: int = 42) -> list[Activity]:
    """Build a plausible activity history for a demo user, scaled to
    account_age_days -- a 3-day-old user gets almost nothing (correctly
    triggering cold start), a 45-day-old user gets enough regular history
    to reach mature-tier patterns on both food and transport.

    The "signal" activities (Thursday chicken, weekday car commute) are
    placed on a deterministic, consistent cadence rather than drawn from
    an independent random coin-flip per day. This matters because
    mine_pattern's confidence formula weighs consistency of spacing, not
    just raw occurrence count (see recommendation_engine.py's mine_pattern
    docstring) -- a per-day random draw can easily produce an irregular
    gap pattern (e.g. hit-hit-hit-miss-hit) that legitimately fails to
    reach mature confidence even at a "high" hit rate, which correctly
    demonstrates the engine being appropriately skeptical of noisy data,
    but defeats the purpose of a demo meant to reliably showcase the
    mature tier. Background/noise activities (electricity) stay randomised
    since they aren't meant to demonstrate a specific mined pattern.

    Purely for demo/UI purposes; a real ingestion layer would never
    synthesise activities like this."""
    rng = random.Random(rng_seed)
    now = datetime.now()
    activities: list[Activity] = []

    # --- signal 1: Thursday chicken, consecutive weeks (verified: 5-6
    # consecutive weekly occurrences reliably clears is_mature; scales down
    # for younger accounts so a cold-start user genuinely has ~0 of these).
    # No deliberate skip here (unlike signal 2 below) -- verified by hand
    # that even one 14-day gap pulls consistency down enough to miss the
    # 0.35 floor at this occurrence count, so a consecutive run is what
    # actually demonstrates the mature tier reliably. ---
    weeks_available = account_age_days // 7
    chicken_weeks_to_fill = min(weeks_available, 6)
    for w in range(0, chicken_weeks_to_fill):
        day = now - timedelta(weeks=w)
        # snap to the most recent Thursday on/before this point so spacing stays ~7 days
        day -= timedelta(days=(day.weekday() - 3) % 7)
        activities.append(Activity(user_id, Category.FOOD, "chicken_curry_cooked", 0.35, "kg", day))

    # --- signal 2: solo car commute, same single weekday each week (verified:
    # a single consistent weekday, not "any weekday", is what lets confidence
    # accumulate -- splitting across all 5 weekdays dilutes each one). No
    # deliberate skip, same reasoning as signal 1 above. ---
    commute_weekday = 1  # Tuesday
    for w in range(0, chicken_weeks_to_fill):
        day = now - timedelta(weeks=w)
        day -= timedelta(days=(day.weekday() - commute_weekday) % 7)
        activities.append(Activity(user_id, Category.TRANSPORT, "car_solo_commute", 6.0, "km", day))

    # --- background noise: standby power most nights, randomised, capped to
    # the actual account age -- this one isn't meant to demonstrate a
    # specific pattern, just give the electricity category some history ---
    lookback = min(account_age_days, 60)
    for d in range(lookback):
        day = now - timedelta(days=d)
        if rng.random() < 0.6:
            activities.append(Activity(user_id, Category.ELECTRICITY, "standby_power_overnight", 1.0, "kwh", day))

    return activities


def build_demo_client() -> MockCarbonCalculationClient:
    """The one call site a real integration changes -- see the module
    docstring's 'SWAPPING IN YOUR REAL CALCULATOR' section."""
    return MockCarbonCalculationClient()
