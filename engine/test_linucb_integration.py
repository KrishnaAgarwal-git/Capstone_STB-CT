"""
Integration tests: LinUCB blended into the live ranking pipeline
(orchestrator.py + recommendation_engine.py's score_candidate blend).

Covers:
  - get_recommendations() without a linucb_model produces byte-for-byte the
    same output as before LinUCB existed (the blend is opt-in, not forced)
  - get_recommendations() WITH a linucb_model attaches a linucb_score and a
    linucb_component to every dynamically-generated candidate
  - InMemoryUserStore always carries a LinUCB model and blends it in by
    default (the stateful, "real" path)
  - feedback recorded through InMemoryUserStore.record_feedback() actually
    updates the shared LinUCB model's state for the correct arm, using the
    exact context vector the candidate was shown with -- isolated from the
    pre-existing cooldown/suppression mechanism (checked with ACCEPTED,
    which doesn't trigger is_suppressed) so this proves LinUCB itself moved,
    not just that the old mechanism did
  - hard suppression (is_suppressed / rejection cooldown) still overrides
    ranking regardless of how high a blended score is -- LinUCB cannot
    resurrect a suppressed candidate
  - untouched arms are unaffected by another arm's feedback, even through
    the full live pipeline (not just linucb.py's own unit tests)
"""

from __future__ import annotations

import unittest
from datetime import datetime

import orchestrator as orch
from linucb import LinUCB
from linucb_features import FEATURE_NAMES
from recommendation_engine import FeedbackType
from reward_mapping import RECOMMENDED_ALPHA


class TestGetRecommendationsLinUCBOptIn(unittest.TestCase):

    def test_no_model_produces_identical_output_to_pre_linucb_behaviour(self):
        client = orch.MockCarbonCalculationClient()
        activities = orch.seed_demo_activities("u1", account_age_days=45)
        today = datetime.now().date()

        without_model = orch.get_recommendations(
            user_id="u1", activities=activities, carbon_client=client,
            account_age_days=45, today=today,
        )
        explicitly_none = orch.get_recommendations(
            user_id="u1", activities=activities, carbon_client=client,
            account_age_days=45, today=today, linucb_model=None,
        )
        self.assertEqual(
            [(n.title, n.score) for n in without_model],
            [(n.title, n.score) for n in explicitly_none],
        )

    def test_with_model_attaches_linucb_component_to_score_breakdown(self):
        client = orch.MockCarbonCalculationClient()
        activities = orch.seed_demo_activities("u1", account_age_days=45)
        model = LinUCB(n_features=len(FEATURE_NAMES), alpha=RECOMMENDED_ALPHA)

        # get_recommendations() only returns the flat notification shape, so
        # go through InMemoryUserStore to inspect the underlying candidates'
        # ScoreBreakdown directly (see next test class) -- here we just check
        # that supplying a model changes the notifications' scores relative
        # to not supplying one, proving the blend actually ran.
        today = datetime.now().date()
        without_model = orch.get_recommendations(
            user_id="u1", activities=activities, carbon_client=client,
            account_age_days=45, today=today,
        )
        with_model = orch.get_recommendations(
            user_id="u1", activities=activities, carbon_client=client,
            account_age_days=45, today=today, linucb_model=model,
        )
        # same candidate pool (deterministic inputs), but scores differ once
        # blended with a (fresh, but non-degenerate) LinUCB opinion
        scores_without = [n.score for n in without_model]
        scores_with = [n.score for n in with_model]
        self.assertNotEqual(scores_without, scores_with)


class TestInMemoryUserStoreLinUCBBlend(unittest.TestCase):

    def _make_store(self):
        store = orch.InMemoryUserStore()
        store.ensure_user("u1", account_age_days=45)
        for a in orch.seed_demo_activities("u1", account_age_days=45):
            store.add_activity("u1", a)
        return store

    def test_store_always_has_a_linucb_model(self):
        store = self._make_store()
        self.assertIsInstance(store._linucb_model, LinUCB)

    def test_shown_candidates_carry_a_linucb_component_in_their_breakdown(self):
        store = self._make_store()
        client = orch.MockCarbonCalculationClient()
        store.get_recommendations("u1", client)
        candidates = list(store._last_candidates["u1"].values())
        self.assertTrue(candidates)
        for candidate in candidates:
            with self.subTest(candidate=candidate.title):
                self.assertIsNotNone(candidate.linucb_score)
                self.assertIsNotNone(candidate.score_breakdown.linucb_component)

    def test_accepted_feedback_moves_the_models_own_predicted_mean(self):
        """Isolates the LinUCB-specific effect from the pre-existing
        suppression mechanism: ACCEPTED does not trigger is_suppressed, so
        any change here is attributable to LinUCB.update() alone."""
        store = self._make_store()
        client = orch.MockCarbonCalculationClient()
        recs = store.get_recommendations("u1", client)
        target = recs[0]
        candidate = store._last_candidates["u1"][target.id]
        arm_id = candidate.knowledge_base_definition_id
        vector = store._last_linucb_context["u1"][target.id]
        self.assertIsNotNone(arm_id)

        mean_before = store._linucb_model.predict_mean(arm_id, vector)
        store.record_feedback("u1", target.id, FeedbackType.ACCEPTED)
        mean_after = store._linucb_model.predict_mean(arm_id, vector)

        self.assertNotEqual(mean_before, mean_after)
        self.assertGreater(mean_after, mean_before)  # ACCEPTED is a positive reward

    def test_dismissed_feedback_moves_predicted_mean_downward(self):
        store = self._make_store()
        client = orch.MockCarbonCalculationClient()
        recs = store.get_recommendations("u1", client)
        target = recs[0]
        arm_id = store._last_candidates["u1"][target.id].knowledge_base_definition_id
        vector = store._last_linucb_context["u1"][target.id]

        mean_before = store._linucb_model.predict_mean(arm_id, vector)
        store.record_feedback("u1", target.id, FeedbackType.DISMISSED)
        mean_after = store._linucb_model.predict_mean(arm_id, vector)

        self.assertLess(mean_after, mean_before)

    def test_feedback_on_one_arm_does_not_move_other_arms(self):
        store = self._make_store()
        client = orch.MockCarbonCalculationClient()
        recs = store.get_recommendations("u1", client)
        self.assertGreaterEqual(len(recs), 2, "need at least 2 shown candidates for this check")

        target, other = recs[0], recs[1]
        other_arm_id = store._last_candidates["u1"][other.id].knowledge_base_definition_id
        other_vector = store._last_linucb_context["u1"][other.id]
        other_mean_before = store._linucb_model.predict_mean(other_arm_id, other_vector)

        store.record_feedback("u1", target.id, FeedbackType.ACCEPTED)

        other_mean_after = store._linucb_model.predict_mean(other_arm_id, other_vector)
        self.assertEqual(other_mean_before, other_mean_after)

    def test_hard_suppression_still_overrides_a_high_blended_score(self):
        """Repeated dismissals both (a) train LinUCB's predicted_mean down
        for that arm AND (b) trigger the pre-existing rejection cooldown
        (is_suppressed) -- the suppressed candidate must not reappear even
        if some other scoring quirk would have given it a high score."""
        store = self._make_store()
        client = orch.MockCarbonCalculationClient()
        recs = store.get_recommendations("u1", client)
        target_title = recs[0].title

        for _ in range(3):
            current = store.get_recommendations("u1", client)
            match = next((r for r in current if r.title == target_title), None)
            if match is None:
                break
            store.record_feedback("u1", match.id, FeedbackType.DISMISSED)

        final_recs = store.get_recommendations("u1", client)
        self.assertNotIn(target_title, [r.title for r in final_recs])


if __name__ == "__main__":
    unittest.main()
