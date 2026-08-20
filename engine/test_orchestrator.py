"""
Tests for orchestrator.py -- the pipeline-wiring layer, not the engine
itself (recommendation_engine.py has its own, separate, untouched test
suite in test_recommendation_engine.py).

These specifically cover the two real bugs found while building this demo,
so a future change to seed_demo_activities or mine_patterns_from_activities
can't silently reintroduce them:
  1. mine_patterns_from_activities originally never mined a food pattern at
     all, because of how activities were grouped (fixed).
  2. seed_demo_activities originally produced gap-inconsistent spacing that
     kept confidence just under mature/mining thresholds even at high
     occurrence counts, because mine_pattern's confidence formula penalises
     irregular gaps and stale most-recent-occurrence dates, not just low
     occurrence counts (fixed).
"""

from datetime import datetime, timedelta

from recommendation_engine import Activity, Category, FeedbackType
from orchestrator import (
    MockCarbonCalculationClient, mine_patterns_from_activities,
    get_recommendations, seed_demo_activities, InMemoryUserStore,
    aggregate_user_carbon_baseline,
)
from recommendations_data import RECOMMENDATIONS


def test_mock_client_returns_estimate_with_mock_source_label():
    """Every mock estimate should be clearly labelled as mock data -- this
    is a safety property (never mistaken for a real number), not just a
    correctness check."""
    client = MockCarbonCalculationClient()
    estimate = client.estimate("chicken_curry_cooked", 0.35, "kg")
    assert estimate.emission_factor.source == "MOCK_DATA"
    assert estimate.co2e_kg > 0


def test_mock_client_raises_keyerror_for_unknown_activity():
    """Matches HttpCarbonCalculationClient's contract -- generate_candidates
    relies on KeyError specifically to skip unavailable activities."""
    client = MockCarbonCalculationClient()
    try:
        client.estimate("totally_unknown_activity", 1.0, "kg")
        assert False, "expected KeyError"
    except KeyError:
        pass


def test_seed_demo_activities_produces_zero_signal_activities_at_cold_start():
    """A 3-day-old account has had essentially no time to establish a
    weekly pattern -- this should hold regardless of internal seeding
    details, since it's the property the cold-start requirement depends on."""
    acts = seed_demo_activities("u1", account_age_days=3)
    chicken = [a for a in acts if a.category == Category.FOOD]
    car = [a for a in acts if a.category == Category.TRANSPORT]
    assert len(chicken) == 0
    assert len(car) == 0


def test_seed_demo_activities_at_45_days_mines_a_mature_transport_pattern():
    """Regression test for bug #2 above: at 45 days, the seeded transport
    history should reliably cross BehaviourPattern.is_mature, not just
    is_early. This is the property the whole demo UI depends on to
    showcase the requires_mature (EV) gate."""
    acts = seed_demo_activities("u1", account_age_days=45)
    patterns = mine_patterns_from_activities(acts, as_of=datetime.now())
    transport_patterns = [p for p in patterns if p.pattern_type == "transport_weekday"]
    assert len(transport_patterns) == 1
    assert transport_patterns[0].is_mature


def test_seed_demo_activities_at_45_days_mines_a_food_pattern():
    """Regression test for bug #1 above: the food (chicken) pattern must
    actually mine, not silently produce zero patterns despite 5+ logged
    occurrences existing in the activity list."""
    acts = seed_demo_activities("u1", account_age_days=45)
    patterns = mine_patterns_from_activities(acts, as_of=datetime.now())
    food_patterns = [p for p in patterns if p.pattern_type == "meal_day_of_week"]
    assert len(food_patterns) == 1
    assert food_patterns[0].occurrences >= 5


def test_get_recommendations_cold_start_user_gets_only_generic_rules():
    """End-to-end: a user with NO activities (zero behavioural evidence,
    profile_confidence.confidence_tier=='cold') should get only
    cold_start_eligible recommendations from the live knowledge-base
    pipeline -- checked against the real 104-entry corpus (recommendations_data),
    not a hardcoded title list, since the live candidate source is now the
    knowledge base rather than the old 10-rule RULE_LIBRARY.

    account_age_days=3 is passed only for signature compatibility -- the
    live pipeline no longer reads it; the cold tier here comes entirely
    from having zero activities (see get_recommendations()'s docstring)."""
    client = MockCarbonCalculationClient()
    notifications = get_recommendations(
        user_id="u1", activities=[], carbon_client=client,
        account_age_days=3, today=datetime.now().date(),
    )
    assert len(notifications) > 0
    cold_start_titles = {r.title for r in RECOMMENDATIONS if r.cold_start_eligible}
    titles = {n.title for n in notifications}
    assert titles <= cold_start_titles


def test_get_recommendations_mature_user_gets_specific_transport_claim():
    """End-to-end: with a real mature-tier transport pattern, the
    notification body should contain the specific, evidence-based claim
    (render_explanation_text's confident branch), not the generic phrasing."""
    client = MockCarbonCalculationClient()
    activities = seed_demo_activities("u1", account_age_days=45)
    notifications = get_recommendations(
        user_id="u1", activities=activities, carbon_client=client,
        account_age_days=45, today=datetime.now().date(),
    )
    transport_notifs = [n for n in notifications if n.category == "transport"]
    assert len(transport_notifs) == 1
    assert "logged" in transport_notifs[0].body  # render_explanation_text's specific-claim phrasing


def test_aggregate_user_carbon_baseline_reachable_through_get_recommendations():
    """The carbon-baseline fix from the prior session should be genuinely
    wired through this orchestration layer, not just testable in isolation
    against the engine directly."""
    client = MockCarbonCalculationClient()
    activities = seed_demo_activities("u1", account_age_days=45)
    baseline = aggregate_user_carbon_baseline(activities, client, as_of=datetime.now())
    assert Category.TRANSPORT in baseline
    assert baseline[Category.TRANSPORT] > 0


def test_inmemory_user_store_feedback_loop_changes_future_recommendations():
    """The store's record_feedback should measurably change
    category_acceptance_rate -- the same feedback-loop property verified in
    the engine's own test suite, but checked here against the store/id
    plumbing this file adds on top of it."""
    store = InMemoryUserStore()
    client = MockCarbonCalculationClient()
    store.ensure_user("u1", account_age_days=45)
    for a in seed_demo_activities("u1", account_age_days=45):
        store.add_activity("u1", a)

    recs_before = store.get_recommendations("u1", client)
    rate_before = dict(store.get_context("u1").category_acceptance_rate)

    transport_rec = next(r for r in recs_before if r.category == "transport")
    store.record_feedback("u1", transport_rec.id, FeedbackType.ACCEPTED)

    rate_after = store.get_context("u1").category_acceptance_rate
    assert rate_after.get(Category.TRANSPORT, 0) != rate_before.get(Category.TRANSPORT, 0)


def test_inmemory_user_store_feedback_on_unknown_id_raises():
    """A notification id from an earlier/different call shouldn't silently
    no-op -- record_feedback should raise so a caller (e.g. the demo
    server) can surface a real error rather than pretend it worked."""
    store = InMemoryUserStore()
    store.ensure_user("u1", account_age_days=10)
    try:
        store.record_feedback("u1", "not-a-real-id", FeedbackType.ACCEPTED)
        assert False, "expected KeyError"
    except KeyError:
        pass


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
