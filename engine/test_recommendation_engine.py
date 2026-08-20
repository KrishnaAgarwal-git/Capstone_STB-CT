"""
Unit tests for the reference recommendation engine.
Run with: pytest test_recommendation_engine.py -v
"""

from datetime import datetime, date, timedelta
import pytest

from recommendation_engine import (
    Activity, Category, Difficulty, TriggerType, FeedbackType,
    EmissionFactor, CarbonEstimate, InMemoryCarbonCalculationClient,
    RecommendationCandidate, UserContext, BehaviourPattern, FeedbackEvent,
    mine_pattern, score_candidate, rank_and_filter, is_suppressed,
    exponential_decay, MIN_DISPLAY_SCORE,
    generate_candidates, project_savings, weekly_occurrence_rate_from_pattern,
    process_feedback, preference_fit,
    PeerGroupContext, PeerAction, peer_relevance, aggregate_peer_group_context,
    aggregate_user_carbon_baseline, normalise_carbon_savings,
)


def _estimate(activity_key, quantity, value_per_unit, source="src", version="v1",
              unit="kg_co2e_per_kg", confidence=0.9):
    """Build a CarbonEstimate directly -- stands in for a Carbon Calculation
    Service API response in tests that don't need the full client."""
    factor = EmissionFactor(factor_key=activity_key, unit=unit, source=source, version=version)
    return CarbonEstimate(
        activity_key=activity_key, quantity=quantity, unit=unit,
        co2e_kg=round(quantity * value_per_unit, 4),
        emission_factor=factor, calculation_confidence=confidence,
    )


# ----------------------------------------------------------------------------
# Carbon estimation tests
# ----------------------------------------------------------------------------
# NOTE: the engine itself no longer computes kg CO2e from a raw factor value --
# that math belongs to the external Carbon Calculation Service. These tests
# therefore construct CarbonEstimate objects directly (as if returned by that
# service) and check that RecommendationCandidate correctly derives
# saved_kg_co2e / percent_reduction from them, without re-deriving the
# underlying emissions itself.

def test_saved_co2e_calculation_matches_spec_example():
    baseline = _estimate("chicken_curry_cooked", 0.35, 6.9, source="Poore_Nemecek_2021", version="v3")
    recommended = _estimate("paneer_curry_cooked", 0.35, 0.9, source="Poore_Nemecek_2021", version="v3")

    c = RecommendationCandidate(
        id="t1", user_id="u1", category=Category.FOOD, action_type="chicken_to_paneer",
        title="t", description="d", difficulty=Difficulty.EASY, trigger_type=TriggerType.RULE,
        source_pattern=None,
        baseline_estimate=baseline, recommended_estimate=recommended,
    )
    assert c.baseline_emissions_kg == pytest.approx(2.415, abs=0.001)
    assert c.recommended_emissions_kg == pytest.approx(0.315, abs=0.001)
    assert c.saved_kg_co2e == pytest.approx(2.1, abs=0.001)
    assert c.percent_reduction == pytest.approx(87.0, abs=0.5)


def test_zero_baseline_does_not_divide_by_zero():
    baseline = _estimate("x", 0.0, 0.0)
    recommended = _estimate("y", 0.0, 0.0)
    c = RecommendationCandidate(
        id="t2", user_id="u1", category=Category.FOOD, action_type="a",
        title="t", description="d", difficulty=Difficulty.EASY, trigger_type=TriggerType.RULE,
        source_pattern=None,
        baseline_estimate=baseline, recommended_estimate=recommended,
    )
    assert c.percent_reduction == 0.0


def _client_for_baseline_tests():
    client = InMemoryCarbonCalculationClient()
    client.register("car_solo_commute", 0.192, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    client.register("chicken_curry", 6.9, "Poore_Nemecek_2021", "v3")
    return client


def test_aggregate_user_carbon_baseline_averages_per_active_day():
    """3 car-commute activities on 3 distinct days -> the per-category baseline
    should be total kg CO2e / 3 active days, not / calendar days in the window
    and not / activity count coincidentally-equal-to-day-count by luck."""
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [
        Activity("u1", Category.TRANSPORT, "car_solo_commute", 6.0, "km", now - timedelta(days=d))
        for d in (1, 5, 10)
    ]
    baseline = aggregate_user_carbon_baseline(activities, _client_for_baseline_tests(), as_of=now)
    expected_per_trip = round(6.0 * 0.192, 4)  # 1.152
    assert baseline[Category.TRANSPORT] == round(expected_per_trip, 4)  # 3 trips / 3 active days = 1 trip/day


def test_aggregate_user_carbon_baseline_averages_multiple_activities_same_day():
    """2 activities logged on the SAME day should average together for that
    day, not be treated as 2 separate active days -- this is what actually
    distinguishes 'per active day' from 'per activity', which the single-
    activity-per-day test above can't tell apart on its own."""
    now = datetime(2026, 7, 30, 8, 0, 0)
    same_day = now - timedelta(days=2)
    activities = [
        Activity("u1", Category.TRANSPORT, "car_solo_commute", 6.0, "km", same_day),
        Activity("u1", Category.TRANSPORT, "car_solo_commute", 4.0, "km", same_day.replace(hour=18)),
    ]
    baseline = aggregate_user_carbon_baseline(activities, _client_for_baseline_tests(), as_of=now)
    total_kg = round((6.0 + 4.0) * 0.192, 4)
    assert baseline[Category.TRANSPORT] == round(total_kg / 1, 4)  # 1 active day, not 2


def test_aggregate_user_carbon_baseline_skips_unknown_activity_key():
    """Mirrors generate_candidates' own KeyError handling: an activity the
    Carbon Calculation Service has no factor for is skipped, never guessed at."""
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [
        Activity("u1", Category.TRANSPORT, "unregistered_activity", 6.0, "km", now - timedelta(days=1)),
    ]
    baseline = aggregate_user_carbon_baseline(activities, _client_for_baseline_tests(), as_of=now)
    assert Category.TRANSPORT not in baseline


def test_aggregate_user_carbon_baseline_respects_window():
    """An activity older than window_days should not count toward the baseline
    -- the baseline should reflect recent typical behaviour, not all-time."""
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [
        Activity("u1", Category.TRANSPORT, "car_solo_commute", 6.0, "km", now - timedelta(days=40)),
    ]
    baseline = aggregate_user_carbon_baseline(activities, _client_for_baseline_tests(),
                                                as_of=now, window_days=28)
    assert Category.TRANSPORT not in baseline


def test_score_candidate_uses_ctx_category_avg_daily_kg_not_a_constant():
    """The regression this test guards against: score_candidate silently
    falling back to a hardcoded constant regardless of what UserContext
    actually contains. Two contexts differing ONLY in category_avg_daily_kg
    must produce different carbon_savings scores for the identical candidate."""
    baseline = _estimate("car_solo_commute", 6.0, 0.192)
    recommended = _estimate("bus_commute", 6.0, 0.089)
    candidate = RecommendationCandidate(
        id="t", user_id="u1", category=Category.TRANSPORT, action_type="solo_car_to_public_transit",
        title="t", description="d", difficulty=Difficulty.EASY, trigger_type=TriggerType.RULE,
        source_pattern=None, baseline_estimate=baseline, recommended_estimate=recommended,
    )
    base_kwargs = dict(
        user_id="u1", category_acceptance_rate={}, category_priority_weight={},
        disabled_categories=set(), dietary_constraints=set(), fatigue_level=0.0,
        recent_action_fingerprints={}, recent_rejected_fingerprints={},
    )
    ctx_low_baseline = UserContext(**base_kwargs, category_avg_daily_kg={Category.TRANSPORT: 0.5})
    ctx_high_baseline = UserContext(**base_kwargs, category_avg_daily_kg={Category.TRANSPORT: 5.0})

    score_low = score_candidate(candidate, ctx_low_baseline, date(2026, 7, 30))
    score_high = score_candidate(candidate, ctx_high_baseline, date(2026, 7, 30))

    # same saved_kg_co2e, but normalised against a smaller baseline -> higher
    # relative impact -> higher carbon_savings score
    assert score_low.carbon_savings > score_high.carbon_savings
    assert score_low.final_score > score_high.final_score


def test_score_candidate_falls_back_gracefully_with_no_baseline_yet():
    """A brand-new user (or a category they've never logged) has an empty
    category_avg_daily_kg -- score_candidate must not crash, and should use
    normalise_carbon_savings' own documented global-scale fallback rather
    than treating the missing baseline as zero savings."""
    baseline = _estimate("car_solo_commute", 6.0, 0.192)
    recommended = _estimate("bus_commute", 6.0, 0.089)
    candidate = RecommendationCandidate(
        id="t", user_id="u1", category=Category.TRANSPORT, action_type="solo_car_to_public_transit",
        title="t", description="d", difficulty=Difficulty.EASY, trigger_type=TriggerType.RULE,
        source_pattern=None, baseline_estimate=baseline, recommended_estimate=recommended,
    )
    ctx = UserContext(
        user_id="u1", category_acceptance_rate={}, category_priority_weight={},
        disabled_categories=set(), dietary_constraints=set(), fatigue_level=0.0,
        recent_action_fingerprints={}, recent_rejected_fingerprints={},
        category_avg_daily_kg={},  # explicitly empty -- no baseline for any category
    )
    score = score_candidate(candidate, ctx, date(2026, 7, 30))
    expected = normalise_carbon_savings(candidate.saved_kg_co2e, 0.0)
    assert score.carbon_savings == round(expected, 3)


def test_candidate_never_computes_emissions_itself_only_reads_estimates():
    """Guards the architectural constraint: RecommendationCandidate must only
    ever read co2e_kg off the estimates it's given, never multiply a factor
    value itself. We assert this by giving it estimates whose co2e_kg values
    are deliberately inconsistent with any 'quantity * factor' interpretation
    a reader might assume -- the candidate must still just take the difference
    of the two co2e_kg fields, unmodified."""
    baseline = _estimate("x", quantity=999, value_per_unit=0.001)  # co2e_kg = 0.999
    recommended = _estimate("y", quantity=0.5, value_per_unit=0.2)  # co2e_kg = 0.1
    c = RecommendationCandidate(
        id="t3", user_id="u1", category=Category.FOOD, action_type="a",
        title="t", description="d", difficulty=Difficulty.EASY, trigger_type=TriggerType.RULE,
        source_pattern=None,
        baseline_estimate=baseline, recommended_estimate=recommended,
    )
    assert c.baseline_emissions_kg == baseline.co2e_kg
    assert c.recommended_emissions_kg == recommended.co2e_kg
    assert c.saved_kg_co2e == pytest.approx(baseline.co2e_kg - recommended.co2e_kg, abs=0.0001)


# ----------------------------------------------------------------------------
# Pattern mining tests
# ----------------------------------------------------------------------------

def test_recency_decay_halflife():
    assert exponential_decay(21.0, half_life=21.0) == pytest.approx(0.5, abs=0.001)
    assert exponential_decay(0.0, half_life=21.0) == pytest.approx(1.0, abs=0.001)


def test_consistent_weekly_pattern_crosses_mature_threshold():
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [
        Activity("u1", Category.FOOD, "chicken", 0.35, "kg", now - timedelta(weeks=w))
        for w in range(1, 5)
    ]
    pattern = mine_pattern("u1", "meal_day_of_week", {"day_of_week": 3}, activities,
                           eligible_opportunities=4, as_of=now)
    assert pattern is not None
    assert pattern.confidence >= 0.65, "evenly spaced, full-occurrence pattern should be mature"


def test_sparse_noisy_pattern_is_discarded():
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [Activity("u1", Category.SHOPPING, "impulse_buy", 1.0, "item", now - timedelta(days=60))]
    pattern = mine_pattern("u1", "shopping_periodic", {}, activities,
                           eligible_opportunities=10, as_of=now)
    assert pattern is None, "low base-rate, stale, single-occurrence signal should not become a pattern"


def test_pattern_requires_minimum_confidence_to_store():
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [Activity("u1", Category.FOOD, "beef", 0.2, "kg", now - timedelta(weeks=1))]
    pattern = mine_pattern("u1", "meal_day_of_week", {}, activities,
                           eligible_opportunities=8, as_of=now)
    assert pattern is None or pattern.confidence < 0.65


# ----------------------------------------------------------------------------
# Scoring / ranking / anti-spam tests
# ----------------------------------------------------------------------------

def _make_candidate(user_id, category, action_type, saved_kg, difficulty=Difficulty.EASY, pattern=None):
    baseline = _estimate(f"{action_type}_baseline", quantity=1.0, value_per_unit=saved_kg + 1.0)
    recommended = _estimate(f"{action_type}_alt", quantity=1.0, value_per_unit=1.0)
    return RecommendationCandidate(
        id=f"cand_{action_type}", user_id=user_id, category=category, action_type=action_type,
        title=action_type, description="d", difficulty=difficulty,
        trigger_type=TriggerType.PATTERN if pattern else TriggerType.RULE,
        source_pattern=pattern,
        baseline_estimate=baseline, recommended_estimate=recommended,
    )


def _default_ctx(user_id="u1", fatigue=0.1):
    return UserContext(
        user_id=user_id,
        category_acceptance_rate={},
        category_priority_weight={},
        disabled_categories=set(),
        dietary_constraints=set(),
        fatigue_level=fatigue,
        recent_action_fingerprints={},
        recent_rejected_fingerprints={},
    )


def test_disabled_category_scores_zero_preference_fit():
    c = _make_candidate("u1", Category.SHOPPING, "buy_less", 2.0)
    ctx = _default_ctx()
    ctx.disabled_categories = {Category.SHOPPING}
    assert preference_fit(c, ctx) == 0.0


def test_vegetarian_constraint_blocks_meat_swap_target():
    c = _make_candidate("u1", Category.FOOD, "beef_to_chicken", 3.0)
    # override the recommended estimate's activity_key to simulate a meat target
    object.__setattr__(c.recommended_estimate, "activity_key", "chicken_curry_cooked")
    ctx = _default_ctx()
    ctx.dietary_constraints = {"vegetarian"}
    assert preference_fit(c, ctx) == 0.0


def test_high_fatigue_reduces_final_score():
    c1 = _make_candidate("u1", Category.TRANSPORT, "carpool", 2.0)
    c2 = _make_candidate("u1", Category.TRANSPORT, "carpool", 2.0)
    low_fatigue_ctx = _default_ctx(fatigue=0.0)
    high_fatigue_ctx = _default_ctx(fatigue=0.9)
    today = date(2026, 7, 30)

    score_low = score_candidate(c1, low_fatigue_ctx, today)
    score_high = score_candidate(c2, high_fatigue_ctx, today)
    assert score_high.final_score < score_low.final_score


def test_rejected_fingerprint_suppressed_within_cooldown():
    c = _make_candidate("u1", Category.FOOD, "chicken_to_paneer", 2.0)
    ctx = _default_ctx()
    ctx.recent_rejected_fingerprints["u1:food:chicken_to_paneer"] = datetime.now() - timedelta(days=3)
    assert is_suppressed(c, ctx, rejection_cooldown_days=14) is True


def test_rejected_fingerprint_not_suppressed_after_cooldown_expires():
    c = _make_candidate("u1", Category.FOOD, "chicken_to_paneer", 2.0)
    ctx = _default_ctx()
    ctx.recent_rejected_fingerprints["u1:food:chicken_to_paneer"] = datetime.now() - timedelta(days=20)
    assert is_suppressed(c, ctx, rejection_cooldown_days=14) is False


def test_category_balancing_limits_one_per_category_when_more_available():
    candidates = [
        _make_candidate("u1", Category.FOOD, "food_a", 3.0),
        _make_candidate("u1", Category.FOOD, "food_b", 2.9),
        _make_candidate("u1", Category.TRANSPORT, "transport_a", 2.5),
        _make_candidate("u1", Category.ELECTRICITY, "energy_a", 2.0),
    ]
    ctx = _default_ctx()
    today = date(2026, 7, 30)
    selected = rank_and_filter(candidates, ctx, today, max_per_day=3)

    categories_selected = [c.category for c in selected]
    assert len(categories_selected) == len(set(categories_selected)), \
        "should not select two from the same category when enough variety exists"


def test_low_scoring_candidates_excluded_below_threshold():
    weak = _make_candidate("u1", Category.SHOPPING, "trivial_swap", 0.01, difficulty=Difficulty.CHALLENGING)
    ctx = _default_ctx(fatigue=0.95)
    today = date(2026, 7, 30)
    selected = rank_and_filter([weak], ctx, today)
    assert all(c.score_breakdown.final_score >= MIN_DISPLAY_SCORE for c in selected)


def test_disabled_category_hard_excluded_by_rank_and_filter_regardless_of_score():
    """rank_and_filter() must exclude a disabled category's candidates
    outright, not merely via preference_fit's soft scoring penalty --
    verified with a candidate that would otherwise clear MIN_DISPLAY_SCORE
    easily (large carbon saving, easy difficulty, no fatigue/repetition
    penalty), so this isn't just testing an already-weak candidate."""
    strong = _make_candidate("u1", Category.SHOPPING, "big_swap", saved_kg=5.0, difficulty=Difficulty.EASY)
    ctx = _default_ctx(fatigue=0.0)
    ctx.disabled_categories = {Category.SHOPPING}
    today = date(2026, 7, 30)

    selected = rank_and_filter([strong], ctx, today)
    assert selected == []


def test_disabled_category_does_not_affect_other_categories():
    disabled = _make_candidate("u1", Category.SHOPPING, "shopping_swap", saved_kg=5.0)
    allowed = _make_candidate("u1", Category.FOOD, "food_swap", saved_kg=5.0)
    ctx = _default_ctx(fatigue=0.0)
    ctx.disabled_categories = {Category.SHOPPING}
    today = date(2026, 7, 30)

    selected = rank_and_filter([disabled, allowed], ctx, today)
    assert [c.category for c in selected] == [Category.FOOD]


# ----------------------------------------------------------------------------
# Candidate generation tests (cold-start / early / mature rule tiers)
# ----------------------------------------------------------------------------

def _demo_carbon_client():
    client = InMemoryCarbonCalculationClient()
    client.register("chicken_curry_cooked", 6.9, "Poore_Nemecek_2021", "v3")
    client.register("paneer_curry_cooked", 0.9, "Poore_Nemecek_2021", "v3")
    client.register("lentil_curry_cooked", 0.5, "Poore_Nemecek_2021", "v3")
    client.register("car_solo_commute", 0.192, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    client.register("car_carpool_commute", 0.096, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    client.register("bus_commute", 0.089, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    client.register("standby_power_overnight", 0.4, "DEFRA_2024", "v1", unit="kg_co2e_per_kwh")
    client.register("devices_off_overnight", 0.0, "DEFRA_2024", "v1", unit="kg_co2e_per_kwh")
    client.register("single_use_plastic_bottle", 0.08, "DEFRA_2024", "v1", unit="kg_co2e_per_item")
    client.register("reusable_bottle_use", 0.0, "DEFRA_2024", "v1", unit="kg_co2e_per_item")
    return client


def test_cold_start_generates_only_cold_start_eligible_rules():
    candidates = generate_candidates(
        user_id="new_user", patterns=[], carbon_client=_demo_carbon_client(),
        account_age_days=2,
    )
    assert len(candidates) > 0
    # none of the cold-start candidates should be pattern-triggered
    assert all(c.trigger_type == TriggerType.RULE for c in candidates)
    # food swap rules require a mined pattern and are NOT cold-start-eligible
    assert all(c.action_type not in ("chicken_to_paneer", "chicken_to_lentils") for c in candidates)


def test_mature_pattern_unlocks_matching_rule():
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [
        Activity("u1", Category.FOOD, "chicken", 0.35, "kg", now - timedelta(weeks=w))
        for w in range(1, 5)
    ]
    pattern = mine_pattern("u1", "meal_day_of_week", {"day_of_week": 3}, activities,
                           eligible_opportunities=4, as_of=now)
    assert pattern is not None and pattern.is_mature

    candidates = generate_candidates(
        user_id="u1", patterns=[pattern], carbon_client=_demo_carbon_client(),
        account_age_days=90,
    )
    action_types = [c.action_type for c in candidates]
    assert "chicken_to_paneer" in action_types
    assert "chicken_to_lentils" in action_types
    # and it should be trigger_type=PATTERN, not a bare rule
    food_candidate = next(c for c in candidates if c.action_type == "chicken_to_paneer")
    assert food_candidate.trigger_type == TriggerType.PATTERN
    assert food_candidate.source_pattern is pattern


def test_generation_skips_activities_missing_from_carbon_service():
    """If the external Carbon Calculation Service has no factor for an
    activity, generation must skip that candidate rather than invent a number."""
    empty_client = InMemoryCarbonCalculationClient()  # no factors registered
    candidates = generate_candidates(
        user_id="u1", patterns=[], carbon_client=empty_client, account_age_days=1,
    )
    assert candidates == []


# ----------------------------------------------------------------------------
# Savings projection tests
# ----------------------------------------------------------------------------

def test_projection_scales_by_weekly_occurrence_not_naive_daily_multiply():
    c = _make_candidate("u1", Category.FOOD, "chicken_to_paneer", 2.1)
    c.weekly_occurrence_rate = 0.8  # occurs on ~0.8 of relevant days per week
    projection = project_savings(c)
    assert projection.daily_kg == pytest.approx(c.saved_kg_co2e, abs=0.0001)
    assert projection.weekly_kg == pytest.approx(c.saved_kg_co2e * 0.8, abs=0.0001)
    # must NOT equal naive daily * 7
    assert projection.weekly_kg != pytest.approx(c.saved_kg_co2e * 7, abs=0.01)
    assert projection.monthly_kg == pytest.approx(projection.weekly_kg * 4.345, abs=0.001)
    assert projection.yearly_kg == pytest.approx(projection.weekly_kg * 52, abs=0.001)


def test_weekly_occurrence_rate_from_pattern_matches_base_rate():
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [
        Activity("u1", Category.FOOD, "chicken", 0.35, "kg", now - timedelta(weeks=w))
        for w in range(1, 5)
    ]
    pattern = mine_pattern("u1", "meal_day_of_week", {"day_of_week": 3}, activities,
                           eligible_opportunities=5, as_of=now)
    rate = weekly_occurrence_rate_from_pattern(pattern)
    assert rate == pytest.approx(pattern.occurrences / pattern.eligible_opportunities, abs=0.001)


def test_weekly_occurrence_rate_defaults_to_one_with_no_pattern():
    assert weekly_occurrence_rate_from_pattern(None) == 1.0


# ----------------------------------------------------------------------------
# Feedback loop tests
# ----------------------------------------------------------------------------

def test_accepted_feedback_increases_acceptance_probability():
    ctx = _default_ctx()
    ctx.category_acceptance_rate[Category.FOOD] = 0.46
    event = FeedbackEvent(
        user_id="u1", recommendation_id="rec1", category=Category.FOOD,
        action_type="chicken_to_paneer", event_type=FeedbackType.ACCEPTED,
        occurred_at=datetime.now(),
    )
    process_feedback(event, ctx, consecutive_dismissals_by_category={})
    assert ctx.category_acceptance_rate[Category.FOOD] > 0.46


def test_dismissed_feedback_decreases_acceptance_probability_and_sets_cooldown():
    ctx = _default_ctx()
    ctx.category_acceptance_rate[Category.TRANSPORT] = 0.5
    event = FeedbackEvent(
        user_id="u1", recommendation_id="rec2", category=Category.TRANSPORT,
        action_type="solo_drive_to_carpool", event_type=FeedbackType.DISMISSED,
        occurred_at=datetime.now(),
    )
    process_feedback(event, ctx, consecutive_dismissals_by_category={})
    assert ctx.category_acceptance_rate[Category.TRANSPORT] < 0.5
    assert "u1:transport:solo_drive_to_carpool" in ctx.recent_rejected_fingerprints


def test_three_consecutive_dismissals_soft_suppresses_category():
    ctx = _default_ctx()
    streaks = {}
    for i in range(3):
        event = FeedbackEvent(
            user_id="u1", recommendation_id=f"rec{i}", category=Category.SHOPPING,
            action_type="buy_less", event_type=FeedbackType.DISMISSED,
            occurred_at=datetime.now(),
        )
        process_feedback(event, ctx, consecutive_dismissals_by_category=streaks)
    assert Category.SHOPPING in ctx.disabled_categories


def test_acceptance_resets_dismissal_streak():
    ctx = _default_ctx()
    streaks = {}
    for i in range(2):
        event = FeedbackEvent(
            user_id="u1", recommendation_id=f"rec{i}", category=Category.SHOPPING,
            action_type="buy_less", event_type=FeedbackType.DISMISSED,
            occurred_at=datetime.now(),
        )
        process_feedback(event, ctx, consecutive_dismissals_by_category=streaks)
    accepted_event = FeedbackEvent(
        user_id="u1", recommendation_id="rec_accept", category=Category.SHOPPING,
        action_type="buy_less", event_type=FeedbackType.ACCEPTED,
        occurred_at=datetime.now(),
    )
    process_feedback(accepted_event, ctx, consecutive_dismissals_by_category=streaks)
    assert streaks[Category.SHOPPING] == 0
    assert Category.SHOPPING not in ctx.disabled_categories


def test_behaviour_unchanged_penalises_more_than_ignored():
    ctx_a = _default_ctx()
    ctx_a.category_acceptance_rate[Category.FOOD] = 0.5
    ctx_b = _default_ctx()
    ctx_b.category_acceptance_rate[Category.FOOD] = 0.5

    process_feedback(
        FeedbackEvent("u1", "r1", Category.FOOD, "a", FeedbackType.BEHAVIOUR_UNCHANGED, datetime.now()),
        ctx_a, {},
    )
    process_feedback(
        FeedbackEvent("u1", "r2", Category.FOOD, "a", FeedbackType.IGNORED, datetime.now()),
        ctx_b, {},
    )
    assert ctx_a.category_acceptance_rate[Category.FOOD] < ctx_b.category_acceptance_rate[Category.FOOD]


# ----------------------------------------------------------------------------
# Peer-group (friend network) awareness tests
# ----------------------------------------------------------------------------

def test_peer_relevance_neutral_when_no_group_data():
    """Graceful degradation: with no PeerGroupContext, peer_relevance must be
    exactly neutral (0.5), not zero -- so scoring behaves the same as before
    this feature existed for any caller that doesn't supply group data."""
    c = _make_candidate("u1", Category.TRANSPORT, "solo_car_to_carpool", 2.0)
    ctx = _default_ctx()
    assert ctx.peer_group is None
    assert peer_relevance(c, ctx) == 0.5


def test_peer_relevance_high_when_peers_do_the_recommended_action_often():
    c = _make_candidate("u1", Category.TRANSPORT, "solo_car_to_carpool", 2.0)
    ctx = _default_ctx()
    ctx.peer_group = PeerGroupContext(
        group_id="g1",
        group_avg_category_kg={Category.TRANSPORT: 2.0},
        user_avg_category_kg={Category.TRANSPORT: 2.0},  # equal to group -- isolate the peer_action signal
        peer_actions=[
            PeerAction("Friend A", Category.TRANSPORT, "solo_car_to_carpool", frequency_per_week=5.0),
        ],
        group_size=3,
    )
    rel = peer_relevance(c, ctx)
    assert rel > 0.5, "frequent matching peer action should push relevance above neutral"


def test_peer_relevance_high_when_user_lags_group_average():
    c = _make_candidate("u1", Category.TRANSPORT, "solo_car_to_carpool", 2.0)
    ctx = _default_ctx()
    ctx.peer_group = PeerGroupContext(
        group_id="g1",
        group_avg_category_kg={Category.TRANSPORT: 1.0},
        user_avg_category_kg={Category.TRANSPORT: 3.0},  # user emits 3x the group average
        peer_actions=[],  # isolate the relative-standing signal
        group_size=4,
    )
    rel = peer_relevance(c, ctx)
    assert rel > 0.5, "user lagging behind group average should push relevance above neutral"


def test_peer_relevance_included_in_final_score_and_explanation():
    c = _make_candidate("u1", Category.TRANSPORT, "solo_car_to_carpool", 2.0)
    ctx = _default_ctx()
    ctx.peer_group = PeerGroupContext(
        group_id="g1",
        group_avg_category_kg={Category.TRANSPORT: 1.0},
        user_avg_category_kg={Category.TRANSPORT: 3.0},
        peer_actions=[PeerAction("Friend A", Category.TRANSPORT, "solo_car_to_carpool", 4.0)],
        group_size=4,
    )
    today = date(2026, 7, 30)
    sb_with_group = score_candidate(c, ctx, today)

    ctx_no_group = _default_ctx()
    c2 = _make_candidate("u1", Category.TRANSPORT, "solo_car_to_carpool", 2.0)
    sb_without_group = score_candidate(c2, ctx_no_group, today)

    assert sb_with_group.peer_relevance > sb_without_group.peer_relevance
    assert sb_with_group.final_score > sb_without_group.final_score


def test_aggregate_peer_group_context_computes_averages_and_peer_actions():
    now = datetime(2026, 7, 30, 8, 0, 0)
    member_activities = {
        "u1": [Activity("u1", Category.TRANSPORT, "car_solo", 6.0, "km", now - timedelta(days=d)) for d in range(4)],
        "u2": [Activity("u2", Category.TRANSPORT, "carpool", 6.0, "km", now - timedelta(days=d)) for d in range(8)],
    }
    ctx = aggregate_peer_group_context("g1", member_activities, this_user_id="u1", window_days=28)

    assert ctx.group_id == "g1"
    assert ctx.group_size == 2
    assert Category.TRANSPORT in ctx.group_avg_category_kg
    assert Category.TRANSPORT in ctx.user_avg_category_kg
    # u2 logged transport activities frequently enough to surface as a peer action
    assert any(p.peer_display_name == "u2" and p.category == Category.TRANSPORT for p in ctx.peer_actions)
    # u1 (this_user_id) must not appear in their own peer_actions list
    assert all(p.peer_display_name != "u1" for p in ctx.peer_actions)


def test_aggregate_peer_group_context_does_not_compute_emissions():
    """Guards the architectural boundary: peer aggregation deals in raw
    quantities only, never kg CO2e -- that still requires the external
    Carbon Calculation Service, which this function must never call."""
    now = datetime(2026, 7, 30, 8, 0, 0)
    member_activities = {
        "u1": [Activity("u1", Category.FOOD, "chicken", 0.35, "kg", now)],
    }
    ctx = aggregate_peer_group_context("g1", member_activities, this_user_id="u1")
    # the averaged value should be the raw quantity (0.35), not any emissions figure
    assert ctx.user_avg_category_kg[Category.FOOD] == pytest.approx(0.35, abs=0.0001)


# ----------------------------------------------------------------------------
# Expanded transportation rule library tests
# ----------------------------------------------------------------------------

def test_transport_rules_cover_vehicle_taxonomy_from_proposal():
    """The proposal's methodology explicitly distinguishes private car,
    two-wheeler, auto-rickshaw, public transit, shared rides, and EVs
    (Section 4-5). The rule library's recommendation *logic* (not tracking/
    verification, which is backend's job) must have real coverage across
    this taxonomy, not just a single generic 'car -> bus' rule."""
    from recommendation_engine import RULE_LIBRARY
    transport_rules = [r for r in RULE_LIBRARY if r.category == Category.TRANSPORT]
    baseline_keys = {r.baseline_activity_key for r in transport_rules}
    recommended_keys = {r.recommended_activity_key for r in transport_rules}

    assert "car_solo_commute" in baseline_keys
    assert "two_wheeler_solo_commute" in baseline_keys
    assert "auto_rickshaw_commute" in baseline_keys
    assert "car_carpool_commute" in recommended_keys
    assert "bus_commute" in recommended_keys
    assert "metro_commute" in recommended_keys
    assert "ev_solo_commute" in recommended_keys
    # no duplicate (baseline, recommended) pairs -- guards against the
    # earlier duplicate-rule issue (solo_car_to_public_transit vs.
    # drive_to_public_transport both targeting the same swap)
    pairs = [(r.baseline_activity_key, r.recommended_activity_key) for r in transport_rules]
    assert len(pairs) == len(set(pairs)), "no two transport rules should recommend the identical swap"


def test_ev_factor_varies_by_region():
    """Per proposal Methodology Section 5: EV emissions depend on the local
    electricity grid mix, so the same activity_key must be able to resolve
    to different co2e_kg in different regions."""
    client = InMemoryCarbonCalculationClient()
    client.register("ev_solo_commute", 0.053, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="GLOBAL")
    client.register("ev_solo_commute", 0.028, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="IN_PUNJAB")
    client.register("ev_solo_commute", 0.071, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="IN_COAL_HEAVY")

    clean_grid = client.estimate("ev_solo_commute", 6.0, "km", region_code="IN_PUNJAB")
    coal_grid = client.estimate("ev_solo_commute", 6.0, "km", region_code="IN_COAL_HEAVY")
    unregistered_region = client.estimate("ev_solo_commute", 6.0, "km", region_code="IN_UNKNOWN")

    assert clean_grid.co2e_kg < coal_grid.co2e_kg
    # unregistered region falls back to the GLOBAL-registered factor rather than erroring
    assert unregistered_region.co2e_kg == pytest.approx(6.0 * 0.053, abs=0.001)


def test_generate_candidates_produces_ev_recommendation_for_mature_commuter():
    now = datetime(2026, 7, 30, 8, 0, 0)
    activities = [
        Activity("u1", Category.TRANSPORT, "car_solo", 6.0, "km", now - timedelta(days=d))
        for d in range(10)
    ]
    pattern = mine_pattern("u1", "transport_weekday", {}, activities,
                           eligible_opportunities=10, as_of=now)
    assert pattern is not None

    client = _demo_carbon_client_with_ev()
    candidates = generate_candidates(
        user_id="u1", patterns=[pattern], carbon_client=client, account_age_days=60,
    )
    action_types = [c.action_type for c in candidates]
    assert "solo_car_to_ev" in action_types


def _demo_carbon_client_with_ev():
    client = _demo_carbon_client()
    client.register("ev_solo_commute", 0.053, "IEA_2024", "v1", unit="kg_co2e_per_km")
    client.register("metro_commute", 0.041, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    return client


def test_requires_mature_rule_withheld_for_early_tier_pattern():
    """The counterpart to test_generate_candidates_produces_ev_recommendation_
    for_mature_commuter above: a pattern that exists but hasn't crossed
    is_mature (0.35-0.65, i.e. is_early) should unlock the ORDINARY matching
    transport rules but NOT solo_car_to_ev, since that rule is flagged
    requires_mature. This is what actually exercises the requires_mature gate
    on its negative case -- without this test, a regression that made
    requires_mature a no-op (e.g. checking `matching_pattern is not None`
    instead of `matching_pattern.is_mature`) would not be caught, because
    every other EV-related test only checks the positive (mature) case."""
    now = datetime(2026, 7, 30, 8, 0, 0)
    # 4 of 10 opportunities -- enough to mine a pattern, not enough to be mature
    activities = [
        Activity("u1", Category.TRANSPORT, "car_solo", 6.0, "km", now - timedelta(days=d))
        for d in (0, 3, 6, 9)
    ]
    pattern = mine_pattern("u1", "transport_weekday", {}, activities,
                           eligible_opportunities=10, as_of=now)
    assert pattern is not None and pattern.is_early and not pattern.is_mature

    client = _demo_carbon_client_with_ev()
    candidates = generate_candidates(
        user_id="u1", patterns=[pattern], carbon_client=client, account_age_days=60,
    )
    action_types = [c.action_type for c in candidates]
    assert "solo_car_to_ev" not in action_types
    # ordinary (non-requires_mature) matching rules should still be unlocked
    assert "solo_car_to_metro" in action_types


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
