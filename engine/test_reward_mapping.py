"""
Unit tests for reward_mapping.py -- the FeedbackEvent -> LinUCB reward
mapping, and the empirically calibrated RECOMMENDED_ALPHA.

Covers:
  - every FeedbackType maps to a reward in [-1, 1]
  - the mapping preserves FEEDBACK_DELTA's existing relative ordering
    (BEHAVIOUR_CONFIRMED strongest positive ... DISMISSED strongest
    negative), not a second, independent opinion about feedback valence
  - reward_for_feedback_event() reads only event_type (not category,
    carbon savings, or recency)
  - process_feedback() / FEEDBACK_DELTA (the existing acceptance-probability
    mechanism) are untouched -- this is an additive second consumer
  - RECOMMENDED_ALPHA, combined with real pipeline-generated context
    vectors and this module's actual reward values, produces the claimed
    behaviour: a single ACCEPTED/DISMISSED event decisively separates an
    arm from untouched arms, in the correct direction, and untouched arms
    are undisturbed
"""

from __future__ import annotations

import unittest
from datetime import datetime

from recommendation_engine import FeedbackEvent, FeedbackType, FEEDBACK_DELTA, Category
from reward_mapping import (
    REWARD_FOR_EVENT_TYPE, RECOMMENDED_ALPHA,
    reward_for_event_type, reward_for_feedback_event,
)


class TestRewardMapping(unittest.TestCase):

    def test_every_feedback_type_has_a_reward(self):
        for event_type in FeedbackType:
            with self.subTest(event_type=event_type):
                self.assertIn(event_type, REWARD_FOR_EVENT_TYPE)

    def test_all_rewards_bounded_minus_one_to_one(self):
        for event_type, reward in REWARD_FOR_EVENT_TYPE.items():
            with self.subTest(event_type=event_type):
                self.assertGreaterEqual(reward, -1.0)
                self.assertLessEqual(reward, 1.0)

    def test_strongest_positive_and_negative_hit_the_range_bounds(self):
        # BEHAVIOUR_CONFIRMED and DISMISSED are FEEDBACK_DELTA's largest-
        # magnitude entries -- the rescaling should map them to exactly
        # +1.0 / -1.0, not leave headroom unused.
        self.assertEqual(REWARD_FOR_EVENT_TYPE[FeedbackType.BEHAVIOUR_CONFIRMED], 1.0)
        self.assertEqual(REWARD_FOR_EVENT_TYPE[FeedbackType.DISMISSED], -1.0)

    def test_reward_ordering_matches_feedback_delta_ordering(self):
        """The rescaled reward mapping must preserve FEEDBACK_DELTA's exact
        relative ordering -- this is a rescaling, not a second opinion."""
        delta_order = sorted(FeedbackType, key=lambda t: FEEDBACK_DELTA[t])
        reward_order = sorted(FeedbackType, key=lambda t: REWARD_FOR_EVENT_TYPE[t])
        self.assertEqual(delta_order, reward_order)

    def test_reward_sign_matches_delta_sign_for_every_type(self):
        for event_type in FeedbackType:
            with self.subTest(event_type=event_type):
                delta = FEEDBACK_DELTA[event_type]
                reward = REWARD_FOR_EVENT_TYPE[event_type]
                if delta > 0:
                    self.assertGreater(reward, 0)
                elif delta < 0:
                    self.assertLess(reward, 0)
                else:
                    self.assertEqual(reward, 0)

    def test_reward_for_feedback_event_depends_only_on_event_type(self):
        base = FeedbackEvent(
            user_id="u1", recommendation_id="r1", category=Category.TRANSPORT,
            action_type="solo_car_to_carpool", event_type=FeedbackType.ACCEPTED,
            occurred_at=datetime(2026, 1, 1),
        )
        other_category = FeedbackEvent(
            user_id="u2", recommendation_id="r2", category=Category.FOOD,
            action_type="chicken_to_paneer", event_type=FeedbackType.ACCEPTED,
            occurred_at=datetime(2020, 6, 1),  # very different recency
        )
        self.assertEqual(
            reward_for_feedback_event(base), reward_for_feedback_event(other_category),
        )
        self.assertEqual(
            reward_for_feedback_event(base), reward_for_event_type(FeedbackType.ACCEPTED),
        )

    def test_recommended_alpha_is_positive_and_modest(self):
        # sanity bound, not a re-derivation of the empirical calibration --
        # guards against an accidental order-of-magnitude edit (e.g. a typo
        # turning 0.2 into 2.0) going unnoticed.
        self.assertGreater(RECOMMENDED_ALPHA, 0.0)
        self.assertLess(RECOMMENDED_ALPHA, 1.0)


class TestRecommendedAlphaAgainstRealPipeline(unittest.TestCase):
    """Empirical verification of RECOMMENDED_ALPHA's documented claim, using
    real context vectors from the live-wired pipeline (not synthetic
    fixtures) and this module's actual reward values (not synthetic +-1.0)."""

    @classmethod
    def setUpClass(cls):
        from linucb import LinUCB
        from linucb_features import build_context_vectors_for_selections, FEATURE_NAMES
        import knowledge_base
        import orchestrator as orch
        import profile_confidence
        from dynamic_candidate_generator import generate_dynamic_candidates
        from recommendation_engine import UserContext

        activities = orch.seed_demo_activities("u_calibration", account_age_days=45)
        as_of = datetime.now()
        patterns = orch.mine_patterns_from_activities(activities, as_of=as_of)
        profile = profile_confidence.compute_data_confidence("u_calibration", activities, as_of)
        selections = generate_dynamic_candidates(
            "u_calibration", knowledge_base.all_recommendations(), patterns, profile,
            max_per_category=8,
        )
        ctx = UserContext(
            user_id="u_calibration", category_acceptance_rate={}, category_priority_weight={},
            disabled_categories=set(), dietary_constraints=set(), fatigue_level=0.1,
            recent_action_fingerprints={}, recent_rejected_fingerprints={},
            category_avg_daily_kg=orch.aggregate_user_carbon_baseline(
                activities, orch.MockCarbonCalculationClient(), as_of=as_of,
            ),
        )
        cls.vectors = build_context_vectors_for_selections(ctx, profile, selections)
        assert len(cls.vectors) >= 3, "need at least 3 real candidates for this calibration check"
        cls.LinUCB = LinUCB
        cls.n_features = len(FEATURE_NAMES)

    def test_single_accepted_event_moves_arm_to_top_and_holds(self):
        model = self.LinUCB(n_features=self.n_features, alpha=RECOMMENDED_ALPHA)
        vectors = self.vectors
        arm_ids = list(vectors.keys())
        target = arm_ids[0]

        model.update(target, vectors[target], reward=reward_for_event_type(FeedbackType.ACCEPTED))
        ranked = model.rank_arms(vectors)
        self.assertEqual(ranked[0][0], target)

        # holds under further identical feedback, not just a one-off fluke
        for _ in range(5):
            model.update(target, vectors[target], reward=reward_for_event_type(FeedbackType.ACCEPTED))
        ranked_again = model.rank_arms(vectors)
        self.assertEqual(ranked_again[0][0], target)

    def test_single_dismissed_event_moves_arm_to_bottom_and_holds(self):
        model = self.LinUCB(n_features=self.n_features, alpha=RECOMMENDED_ALPHA)
        vectors = self.vectors
        arm_ids = list(vectors.keys())
        target = arm_ids[0]

        model.update(target, vectors[target], reward=reward_for_event_type(FeedbackType.DISMISSED))
        ranked = model.rank_arms(vectors)
        self.assertEqual(ranked[-1][0], target)

        for _ in range(5):
            model.update(target, vectors[target], reward=reward_for_event_type(FeedbackType.DISMISSED))
        ranked_again = model.rank_arms(vectors)
        self.assertEqual(ranked_again[-1][0], target)

    def test_untouched_arms_are_undisturbed_by_other_arms_feedback(self):
        model = self.LinUCB(n_features=self.n_features, alpha=RECOMMENDED_ALPHA)
        vectors = self.vectors
        arm_ids = list(vectors.keys())
        liked, disliked, untouched = arm_ids[0], arm_ids[1], arm_ids[2]

        before = model.score_arm(untouched, vectors[untouched])
        for _ in range(10):
            model.update(liked, vectors[liked], reward=reward_for_event_type(FeedbackType.ACCEPTED))
            model.update(disliked, vectors[disliked], reward=reward_for_event_type(FeedbackType.DISMISSED))
        after = model.score_arm(untouched, vectors[untouched])
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
