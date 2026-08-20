"""
Unit tests for linucb.py -- the disjoint LinUCB contextual bandit primitive.

Covers:
  - a fresh arm predicts mean 0.0 (untouched ridge-regression state)
  - repeated updates move the predicted mean toward the observed reward
  - arms are genuinely independent (disjoint) -- updating one never
    changes another arm's prediction
  - alpha controls exploration bonus magnitude
  - ridge_lambda controls initial uncertainty magnitude
  - select_arm / rank_arms pick correctly and respect the per-round
    available-arms restriction
  - dimension mismatches raise, not silently misbehave
  - to_state()/from_state() round-trips exactly
  - works at the real feature dimensionality produced by linucb_features.py
"""

from __future__ import annotations

import math
import unittest

from linucb import LinUCB


class TestLinUCB(unittest.TestCase):

    def test_fresh_arm_predicts_zero_mean(self):
        model = LinUCB(n_features=3, alpha=1.0)
        self.assertEqual(model.predict_mean("arm_a", [1.0, 2.0, 3.0]), 0.0)

    def test_fresh_arm_score_is_exploration_only(self):
        model = LinUCB(n_features=3, alpha=1.0)
        x = [1.0, 0.0, 0.0]
        self.assertAlmostEqual(model.score_arm("arm_a", x), model.uncertainty("arm_a", x))

    def test_repeated_positive_reward_pulls_predicted_mean_up(self):
        model = LinUCB(n_features=2, alpha=0.0, ridge_lambda=1.0)
        x = [1.0, 0.0]
        for _ in range(200):
            model.update("arm_a", x, reward=1.0)
        # ridge regression on many repeated (x, r=1.0) observations should
        # converge close to predicting 1.0 for this same x
        self.assertAlmostEqual(model.predict_mean("arm_a", x), 1.0, places=2)

    def test_repeated_zero_reward_keeps_predicted_mean_near_zero(self):
        model = LinUCB(n_features=2, alpha=0.0)
        x = [1.0, 0.0]
        for _ in range(50):
            model.update("arm_a", x, reward=0.0)
        self.assertAlmostEqual(model.predict_mean("arm_a", x), 0.0, places=6)

    def test_arms_are_disjoint_updating_one_does_not_affect_another(self):
        model = LinUCB(n_features=2, alpha=0.0)
        x = [1.0, 0.0]
        for _ in range(50):
            model.update("arm_a", x, reward=1.0)
        # arm_b was never updated -- must still be a fresh, untouched arm
        self.assertEqual(model.predict_mean("arm_b", x), 0.0)
        self.assertNotEqual(model.predict_mean("arm_a", x), model.predict_mean("arm_b", x))

    def test_higher_alpha_increases_ucb_score(self):
        low = LinUCB(n_features=3, alpha=0.1)
        high = LinUCB(n_features=3, alpha=5.0)
        x = [1.0, 1.0, 1.0]
        self.assertLess(low.score_arm("arm_a", x), high.score_arm("arm_a", x))

    def test_higher_ridge_lambda_decreases_initial_uncertainty(self):
        loose = LinUCB(n_features=3, alpha=1.0, ridge_lambda=1.0)
        tight = LinUCB(n_features=3, alpha=1.0, ridge_lambda=100.0)
        x = [1.0, 1.0, 1.0]
        self.assertGreater(loose.uncertainty("arm_a", x), tight.uncertainty("arm_a", x))

    def test_uncertainty_shrinks_as_evidence_accumulates(self):
        model = LinUCB(n_features=2, alpha=1.0)
        x = [1.0, 0.0]
        before = model.uncertainty("arm_a", x)
        for _ in range(20):
            model.update("arm_a", x, reward=0.5)
        after = model.uncertainty("arm_a", x)
        self.assertLess(after, before)

    def test_select_arm_picks_the_highest_scoring_arm(self):
        model = LinUCB(n_features=2, alpha=0.0)  # alpha=0 -> pure exploitation, deterministic
        x = [1.0, 0.0]
        for _ in range(50):
            model.update("winner", x, reward=1.0)
            model.update("loser", x, reward=0.0)
        chosen = model.select_arm({"winner": x, "loser": x})
        self.assertEqual(chosen, "winner")

    def test_select_arm_only_considers_available_arms(self):
        """A per-round available-arms restriction (e.g. this week's
        dynamically generated candidate pool) must be respected -- an arm
        with strong accumulated history that isn't offered this round must
        never be selected."""
        model = LinUCB(n_features=2, alpha=0.0)
        x = [1.0, 0.0]
        for _ in range(50):
            model.update("strong_but_unavailable", x, reward=1.0)
            model.update("weak_but_available", x, reward=0.1)
        chosen = model.select_arm({"weak_but_available": x})
        self.assertEqual(chosen, "weak_but_available")

    def test_rank_arms_returns_all_candidates_sorted_descending(self):
        model = LinUCB(n_features=2, alpha=0.0)
        x = [1.0, 0.0]
        for _ in range(30):
            model.update("high", x, reward=1.0)
            model.update("mid", x, reward=0.5)
            model.update("low", x, reward=0.0)
        ranked = model.rank_arms({"low": x, "high": x, "mid": x})
        self.assertEqual([arm_id for arm_id, _ in ranked], ["high", "mid", "low"])
        scores = [score for _, score in ranked]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_select_arm_raises_on_empty_candidates(self):
        model = LinUCB(n_features=2)
        with self.assertRaises(ValueError):
            model.select_arm({})

    def test_score_arm_raises_on_dimension_mismatch(self):
        model = LinUCB(n_features=3)
        with self.assertRaises(ValueError):
            model.score_arm("arm_a", [1.0, 2.0])  # wrong length

    def test_n_features_must_be_positive(self):
        with self.assertRaises(ValueError):
            LinUCB(n_features=0)

    def test_known_arms_tracks_seen_arms(self):
        model = LinUCB(n_features=2)
        self.assertEqual(model.known_arms(), [])
        model.score_arm("arm_a", [1.0, 0.0])
        self.assertEqual(model.known_arms(), ["arm_a"])

    def test_reset_arm_discards_accumulated_state(self):
        model = LinUCB(n_features=2, alpha=0.0)
        x = [1.0, 0.0]
        for _ in range(20):
            model.update("arm_a", x, reward=1.0)
        self.assertNotEqual(model.predict_mean("arm_a", x), 0.0)
        model.reset_arm("arm_a")
        self.assertEqual(model.predict_mean("arm_a", x), 0.0)

    def test_reset_arm_on_unknown_arm_is_a_noop(self):
        model = LinUCB(n_features=2)
        model.reset_arm("never_seen")  # must not raise

    def test_to_state_from_state_round_trip_preserves_predictions(self):
        original = LinUCB(n_features=3, alpha=0.7, ridge_lambda=2.0)
        for i, x in enumerate([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 1.0, 0.0]]):
            original.update("arm_a", x, reward=0.3 * i)
            original.update("arm_b", x, reward=0.9)

        state = original.to_state()
        restored = LinUCB.from_state(state)

        self.assertEqual(restored.n_features, original.n_features)
        self.assertEqual(restored.alpha, original.alpha)
        self.assertEqual(restored.ridge_lambda, original.ridge_lambda)
        for arm_id in ("arm_a", "arm_b"):
            for x in ([1.0, 0.0, 0.0], [0.5, 0.5, 0.5]):
                self.assertAlmostEqual(
                    original.score_arm(arm_id, x), restored.score_arm(arm_id, x), places=10,
                )

    def test_to_state_is_json_serialisable(self):
        import json
        model = LinUCB(n_features=2)
        model.update("arm_a", [1.0, 0.0], reward=1.0)
        # must not raise
        json.dumps(model.to_state())

    def test_works_at_real_feature_adapter_dimensionality(self):
        """Sanity check against the actual dimensionality linucb_features.py
        produces, so a future drift between the two modules' assumptions
        about vector length is caught here rather than only at integration
        time."""
        from linucb_features import FEATURE_NAMES
        model = LinUCB(n_features=len(FEATURE_NAMES), alpha=1.0)
        x = [0.5] * len(FEATURE_NAMES)
        score = model.score_arm("FOO-001", x)
        self.assertTrue(math.isfinite(score))


if __name__ == "__main__":
    unittest.main()
