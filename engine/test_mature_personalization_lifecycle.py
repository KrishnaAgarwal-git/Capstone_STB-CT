"""
Task 7: mature personalization, verified end-to-end as one continuous story
(cold -> progressive -> established), not as separately-tested snapshots.

The target architecture (see the project's own framing) describes three
lifecycle phases -- but this codebase deliberately does NOT gate them on
account age (see profile_confidence.py's module docstring and the earlier
account-age-bug fix). With LinUCB now in the mix, there are actually TWO
independent maturity axes to verify together:

  1. Data-confidence tier (profile_confidence.py, per-user, activity-driven)
     -- governs which candidates are ELIGIBLE at all (dynamic_candidate_
     generator.py's tier gate, requires_mature gate).
  2. LinUCB per-arm training depth (linucb.py, SHARED across all users --
     arms are knowledge_base definition ids, not per-user) -- governs how
     much a candidate's RANKING is influenced by accumulated feedback.

Because LinUCB's arm state is genuinely shared/global (see orchestrator.py's
InMemoryUserStore -- one model, many users), a new risk exists that didn't
before: could one user's heavy feedback history leak inappropriate
personalization to a DIFFERENT, data-sparse user, via the shared arm state?
This file's most important test (TestCrossUserLeakageProtection) checks
exactly that -- and confirms the answer is no, because eligibility gating
(axis 1, per-user) happens upstream of and independently from LinUCB ranking
(axis 2, shared), so LinUCB can never make an ineligible candidate visible.

Covers:
  - tier progression (cold -> developing -> established) still holds
    correctly through the FULL live store pipeline with LinUCB attached,
    across the same 5 profile shapes used to originally verify the
    account-age bug fix (closes a gap: that verification was previously
    manual/ad-hoc, not a committed regression test)
  - account-age independence still holds end-to-end with LinUCB active
  - a sparse-old account never gets a requires_mature candidate even after
    the SHARED LinUCB model has been heavily, positively trained on that
    exact arm by a different, data-rich user
  - the shared model produces genuinely per-user personalized rankings (a
    given arm's LinUCB opinion is identical for two users -- proving state
    isn't secretly forked per user -- but their blended final_score for it
    differs, because personalization comes from the CONTEXT vector, not
    from separate models)
  - personalization measurably strengthens over many simulated weeks of
    feedback for one fixed user (a continuous trajectory, not a snapshot)
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta

import knowledge_base
import orchestrator as orch
import profile_confidence
import recommendations_data
from dynamic_candidate_generator import generate_dynamic_candidates
from linucb_features import build_context_vector
from recommendation_engine import Activity, Category, FeedbackType
from reward_mapping import reward_for_event_type

REQUIRES_MATURE_TITLES = {r.title for r in recommendations_data.RECOMMENDATIONS if r.requires_mature}


def _build_reliable_mature_transport_activities(user_id: str, now: datetime) -> list[Activity]:
    """8 evenly-spaced (7-day gap) weekday car-commute activities (guaranteed
    to land on a real weekday regardless of what day tests run on), PLUS
    some background electricity/food activity -- needed so this user's
    OVERALL profile.confidence_tier reaches "established", not just their
    transport pattern reaching is_mature. The two are different gates
    (dynamic_candidate_generator.py's requires_mature check needs BOTH: the
    profile-level tier AND the individual pattern's own maturity -- a user
    who only ever logs transport lands in "developing" tier despite a
    perfectly mature transport pattern, per profile_confidence.py's spread_score
    component, and requires_mature definitions stay locked at "developing").

    Deliberately NOT using orchestrator.seed_demo_activities() for the
    transport signal -- that function's own transport signal is currently
    borderline/date-sensitive around today's date (see the pre-existing,
    unrelated failing test test_orchestrator.py::test_seed_demo_activities_
    at_45_days_mines_a_mature_transport_pattern). This test needs a RELIABLY
    mature pattern to test the property it's actually about (cross-user
    LinUCB leakage protection), not incidentally re-test seed_demo_activities'
    own flakiness.
    """
    anchor = now
    while anchor.weekday() >= 5:  # walk back to the most recent weekday
        anchor -= timedelta(days=1)
    transport = [
        Activity(user_id, Category.TRANSPORT, "car_solo_commute", 6.0, "km", anchor - timedelta(weeks=w))
        for w in range(8)
    ]
    background_electricity = [
        Activity(user_id, Category.ELECTRICITY, "standby_power_overnight", 1.0, "kwh", now - timedelta(days=d))
        for d in range(12)
    ]
    background_food = [
        Activity(user_id, Category.FOOD, "chicken_curry_cooked", 0.35, "kg", now - timedelta(days=d * 3))
        for d in range(4)
    ]
    return transport + background_electricity + background_food


class TestTierProgressionRegressionWithLinUCBActive(unittest.TestCase):
    """The same 5 profile shapes the account-age bug was originally verified
    against, now run through the full live InMemoryUserStore pipeline
    (LinUCB attached) instead of the bare profile_confidence/dynamic_
    candidate_generator functions -- closes the gap that this was
    previously checked manually, not as a committed test."""

    PROFILES = [
        ("cold_new", 3, None),
        ("cold_sparse_old", 40, 4),
        ("developing", 15, None),
        ("established_dense", 35, None),
        ("established_sparse", 35, 6),
    ]

    def _run_profile(self, name: str, account_age_days: int, truncate_to):
        store = orch.InMemoryUserStore()
        client = orch.MockCarbonCalculationClient()
        store.ensure_user(name, account_age_days=account_age_days)
        activities = orch.seed_demo_activities(name, account_age_days=account_age_days)
        if truncate_to is not None:
            activities = activities[:truncate_to]
        for a in activities:
            store.add_activity(name, a)
        recs = store.get_recommendations(name, client)
        return store, recs

    def test_established_sparse_never_shows_a_requires_mature_title(self):
        store, recs = self._run_profile("established_sparse", 35, 6)
        titles = {r.title for r in recs}
        offending = titles & REQUIRES_MATURE_TITLES
        self.assertFalse(
            offending, f"established_sparse (old account, sparse data) showed "
            f"requires_mature title(s): {offending}",
        )

    def test_every_profile_produces_at_least_one_recommendation(self):
        for name, age, truncate_to in self.PROFILES:
            with self.subTest(profile=name):
                _, recs = self._run_profile(name, age, truncate_to)
                self.assertGreater(len(recs), 0)

    def test_account_age_independence_holds_end_to_end_with_linucb_active(self):
        """Same activities, wildly different account_age_days -- output must
        be identical (titles + scores), same property verified manually
        right after the account-age bug fix, now checked through the full
        LinUCB-blended pipeline as a committed regression test."""
        activities = orch.seed_demo_activities("u_fixed", account_age_days=20)
        client = orch.MockCarbonCalculationClient()

        store_young_label = orch.InMemoryUserStore()
        store_young_label.ensure_user("u_fixed", account_age_days=3)
        for a in activities:
            store_young_label.add_activity("u_fixed", a)
        recs_young_label = store_young_label.get_recommendations("u_fixed", client)

        store_old_label = orch.InMemoryUserStore()
        store_old_label.ensure_user("u_fixed", account_age_days=9999)
        for a in activities:
            store_old_label.add_activity("u_fixed", a)
        recs_old_label = store_old_label.get_recommendations("u_fixed", client)

        # LinUCB models are freshly-constructed and untrained in both stores,
        # so a fair comparison -- any difference would have to come from
        # account_age_days, which is exactly what this test guards against.
        self.assertEqual(
            [(r.title, r.score) for r in recs_young_label],
            [(r.title, r.score) for r in recs_old_label],
        )


class TestCrossUserLeakageProtection(unittest.TestCase):
    """The most important test in this file: a shared, global LinUCB model
    must never let one user's feedback history make an ineligible candidate
    visible to a different, data-sparse user."""

    def test_sparse_old_user_never_sees_ev_recommendation_even_after_another_users_heavy_training(self):
        store = orch.InMemoryUserStore()
        client = orch.MockCarbonCalculationClient()
        now = datetime.now()

        # --- Step 1: a data-rich user with a RELIABLY mature transport
        # pattern (needed to unlock TRN-006 / solo_car_to_ev's requires_mature
        # gate at all) trains the shared model hard and positively on it. ---
        rich_activities = _build_reliable_mature_transport_activities("rich_user", now)
        patterns = orch.mine_patterns_from_activities(rich_activities, as_of=now)
        transport_patterns = [p for p in patterns if p.pattern_type == "transport_weekday"]
        self.assertEqual(len(transport_patterns), 1)
        self.assertTrue(
            transport_patterns[0].is_mature,
            "test setup requires a reliably mature transport pattern -- "
            f"got confidence={transport_patterns[0].confidence}",
        )

        rich_profile = profile_confidence.compute_data_confidence("rich_user", rich_activities, now)
        self.assertEqual(
            rich_profile.confidence_tier, "established",
            "test setup requires an established-tier profile (not just a mature "
            f"pattern) to unlock requires_mature at all -- got {rich_profile}",
        )
        rich_selections = generate_dynamic_candidates(
            "rich_user", knowledge_base.all_recommendations(), patterns, rich_profile, max_per_category=8,
        )
        ev_selection = next((s for s in rich_selections if s.definition.id == "TRN-006"), None)
        self.assertIsNotNone(ev_selection, "TRN-006 should be eligible for the data-rich mature user")

        # rich_user is never registered with this store (only its shared
        # _linucb_model is used directly, to train the arm) -- a plain
        # neutral UserContext is enough to build the context vector here.
        ev_vector = build_context_vector(_neutral_ctx(), rich_profile, ev_selection)
        for _ in range(30):
            store._linucb_model.update("TRN-006", ev_vector, reward_for_event_type(FeedbackType.BEHAVIOUR_CONFIRMED))

        mean_after_training = store._linucb_model.predict_mean("TRN-006", ev_vector)
        self.assertGreater(mean_after_training, 0.5, "training setup did not actually move the TRN-006 arm")

        # --- Step 2: a completely different, OLD-but-SPARSE user (established_sparse
        # shape) must never see TRN-006, regardless of how strongly the SHARED
        # model now feels about that arm. ---
        store.ensure_user("sparse_user", account_age_days=40)
        sparse_activities = orch.seed_demo_activities("sparse_user", account_age_days=40)[:4]
        for a in sparse_activities:
            store.add_activity("sparse_user", a)

        # Structural guard: TRN-006 must not even be ELIGIBLE for this user --
        # this is the actual mechanism that prevents leakage (eligibility
        # gating happens upstream of and independently from LinUCB ranking).
        as_of = datetime.now()
        sparse_patterns = orch.mine_patterns_from_activities(sparse_activities, as_of=as_of)
        sparse_profile = profile_confidence.compute_data_confidence("sparse_user", sparse_activities, as_of)
        sparse_selections = generate_dynamic_candidates(
            "sparse_user", knowledge_base.all_recommendations(), sparse_patterns, sparse_profile,
            max_per_category=8,
        )
        self.assertFalse(
            any(s.definition.id == "TRN-006" for s in sparse_selections),
            "TRN-006 must not be eligible for the sparse/non-mature user, "
            "regardless of the shared model's trained-up opinion about it",
        )

        # End-to-end confirmation through the actual live path, sharing the
        # SAME (now heavily-trained) model instance.
        recs = store.get_recommendations("sparse_user", client)
        titles = {r.title for r in recs}
        self.assertNotIn("Consider an EV for This Route", titles)


def _neutral_ctx():
    from recommendation_engine import UserContext
    return UserContext(
        user_id="rich_user", category_acceptance_rate={}, category_priority_weight={},
        disabled_categories=set(), dietary_constraints=set(), fatigue_level=0.0,
        recent_action_fingerprints={}, recent_rejected_fingerprints={},
        category_avg_daily_kg={},
    )


class TestSharedModelStillPersonalizesPerUser(unittest.TestCase):
    """Confirms personalization comes from the per-user CONTEXT vector, not
    from LinUCB secretly maintaining separate state per user -- both must be
    true simultaneously for the shared-arm architecture to be correct."""

    def test_same_arm_same_linucb_opinion_but_different_blended_score_across_users(self):
        store = orch.InMemoryUserStore()
        client = orch.MockCarbonCalculationClient()

        store.ensure_user("transport_heavy", account_age_days=45)
        for a in orch.seed_demo_activities("transport_heavy", account_age_days=45):
            store.add_activity("transport_heavy", a)
        # give this user a strong positive transport acceptance history via
        # the PRE-EXISTING (non-LinUCB) feedback mechanism, so their
        # rules-based score for a transport candidate differs from a neutral
        # user's -- the thing we expect to vary between users.
        store.get_context("transport_heavy").category_acceptance_rate[Category.TRANSPORT] = 0.9

        store.ensure_user("neutral_user", account_age_days=45)
        for a in orch.seed_demo_activities("neutral_user", account_age_days=45):
            store.add_activity("neutral_user", a)

        recs_a = store.get_recommendations("transport_heavy", client)
        recs_b = store.get_recommendations("neutral_user", client)

        cand_a = next(
            (c for c in store._last_candidates["transport_heavy"].values() if c.category == Category.TRANSPORT),
            None,
        )
        cand_b = next(
            (c for c in store._last_candidates["neutral_user"].values() if c.category == Category.TRANSPORT),
            None,
        )
        self.assertIsNotNone(cand_a)
        self.assertIsNotNone(cand_b)

        if cand_a.knowledge_base_definition_id == cand_b.knowledge_base_definition_id:
            # same arm shown to both -- prove the SAME shared model object
            # (store._linucb_model, not a per-user fork) produces each
            # user's linucb_score purely as a function of (arm, their own
            # context vector), by recomputing it directly and matching what
            # was actually attached live.
            arm_id = cand_a.knowledge_base_definition_id
            vec_a = store._last_linucb_context["transport_heavy"][
                next(r.id for r in recs_a if r.title == cand_a.title)
            ]
            vec_b = store._last_linucb_context["neutral_user"][
                next(r.id for r in recs_b if r.title == cand_b.title)
            ]
            # the CONTEXT vectors differ (acceptance_rate feature)...
            self.assertNotEqual(vec_a, vec_b)
            # ...and re-scoring the SAME shared model with each user's own
            # vector reproduces exactly what was attached to their candidate
            # -- confirming there's no hidden per-user model state, only the
            # context differing.
            self.assertEqual(
                store._linucb_model.predict_mean(arm_id, vec_a)
                + store._linucb_model.uncertainty(arm_id, vec_a),
                cand_a.linucb_score,
            )
            self.assertEqual(
                store._linucb_model.predict_mean(arm_id, vec_b)
                + store._linucb_model.uncertainty(arm_id, vec_b),
                cand_b.linucb_score,
            )
        self.assertNotEqual(cand_a.score_breakdown.final_score, cand_b.score_breakdown.final_score)


class TestPersonalizationStrengthensOverManyWeeks(unittest.TestCase):

    def test_linucb_influence_grows_from_near_neutral_to_decisive_over_simulated_weeks(self):
        """Tracks a concrete numeric trajectory (not just a tier snapshot):
        how far the shown candidates' linucb_component sits from the neutral
        0.5 default, averaged per week, over a long simulated feedback
        history for one fixed user."""
        store = orch.InMemoryUserStore()
        client = orch.MockCarbonCalculationClient()
        store.ensure_user("u_longitudinal", account_age_days=45)
        for a in orch.seed_demo_activities("u_longitudinal", account_age_days=45):
            store.add_activity("u_longitudinal", a)

        def avg_distance_from_neutral(recs):
            candidates = store._last_candidates["u_longitudinal"].values()
            components = [
                c.score_breakdown.linucb_component for c in candidates
                if c.score_breakdown.linucb_component is not None
            ]
            return sum(abs(v - 0.5) for v in components) / len(components)

        week1_recs = store.get_recommendations("u_longitudinal", client)
        week1_distance = avg_distance_from_neutral(week1_recs)

        for week in range(25):
            recs = store.get_recommendations("u_longitudinal", client)
            for i, rec in enumerate(recs):
                event = FeedbackType.BEHAVIOUR_CONFIRMED if i == 0 else FeedbackType.DISMISSED
                store.record_feedback("u_longitudinal", rec.id, event)

        final_recs = store.get_recommendations("u_longitudinal", client)
        final_distance = avg_distance_from_neutral(final_recs)

        self.assertGreater(
            final_distance, week1_distance,
            f"expected LinUCB's influence to strengthen over time: "
            f"week1={week1_distance:.4f} vs after 25 weeks={final_distance:.4f}",
        )


if __name__ == "__main__":
    unittest.main()
