"""
Unit tests for the LinUCB feature adapter (linucb_features.py).

Covers:
  - vector length always matches FEATURE_NAMES
  - every feature value is bounded in [0.0, 1.0]
  - bias term is always exactly 1.0
  - pattern_confidence reflects the matched pattern (or the documented
    neutral default when there isn't one)
  - tier / matched_via one-hot blocks are genuinely one-hot
  - the vector actually varies with its inputs (not a constant/dead feature)
  - account-age-free: no public function in this module accepts or reads
    account_age_days, checked via introspection so a future edit can't
    silently reintroduce the dependency
  - batch helper keys vectors by definition id and matches the single-item
    function exactly
"""

from __future__ import annotations

import inspect
import unittest
from datetime import datetime, timedelta

from dynamic_candidate_generator import CandidateSelection
from knowledge_base import RecommendationDefinition
from linucb_features import (
    FEATURE_NAMES, build_context_vector, build_context_vectors_for_selections,
)
from profile_confidence import DataConfidenceProfile
from recommendation_engine import BehaviourPattern, Category, Difficulty, UserContext


def _make_definition(
    id: str = "TST-001",
    category: Category = Category.TRANSPORT,
    difficulty: Difficulty = Difficulty.EASY,
    requires_mature: bool = False,
    cold_start_eligible: bool = False,
    estimated_impact_band: str = "medium",
) -> RecommendationDefinition:
    return RecommendationDefinition(
        id=id, category=category, title=f"Title {id}",
        description_template="Do the thing.", action_type=f"action_{id}",
        baseline_activity_key="baseline_key", recommended_activity_key="recommended_key",
        default_quantity=1.0, unit="item", difficulty=difficulty,
        tags=("test",), applicable_pattern_types=("transport_weekday",),
        cold_start_eligible=cold_start_eligible, requires_mature=requires_mature,
        estimated_impact_band=estimated_impact_band, conditions={},
        source_note="test fixture",
    )


def _make_pattern(confidence: float = 0.7) -> BehaviourPattern:
    now = datetime.now()
    return BehaviourPattern(
        user_id="u1", pattern_type="transport_weekday", dimensions={"day_of_week": 1},
        occurrences=6, eligible_opportunities=9, confidence=confidence,
        last_observed_at=now, first_observed_at=now - timedelta(days=42),
    )


def _make_selection(
    definition=None, category=Category.TRANSPORT, relevance_score=0.6,
    matched_pattern=None, matched_via="cold_start_default",
) -> CandidateSelection:
    return CandidateSelection(
        definition=definition or _make_definition(category=category),
        category=category, relevance_score=relevance_score,
        matched_pattern=matched_pattern, matched_via=matched_via,
    )


def _make_profile(
    total_records=10, category_coverage=None, confidence_tier="developing",
    overall_confidence=0.5, completeness_score=0.5,
) -> DataConfidenceProfile:
    return DataConfidenceProfile(
        user_id="u1", total_records=total_records, active_days=5,
        category_coverage=category_coverage or {Category.TRANSPORT: 4},
        categories_covered=1, date_range_days=10, recency_days=1.0,
        completeness_score=completeness_score, overall_confidence=overall_confidence,
        confidence_tier=confidence_tier,
    )


def _make_ctx(
    category_acceptance_rate=None, category_priority_weight=None,
    disabled_categories=None, fatigue_level=0.2, category_avg_daily_kg=None,
) -> UserContext:
    return UserContext(
        user_id="u1",
        category_acceptance_rate=category_acceptance_rate or {},
        category_priority_weight=category_priority_weight or {},
        disabled_categories=disabled_categories or set(),
        dietary_constraints=set(), fatigue_level=fatigue_level,
        recent_action_fingerprints={}, recent_rejected_fingerprints={},
        category_avg_daily_kg=category_avg_daily_kg or {},
    )


class TestBuildContextVector(unittest.TestCase):

    def test_vector_length_matches_feature_names(self):
        vector = build_context_vector(_make_ctx(), _make_profile(), _make_selection())
        self.assertEqual(len(vector), len(FEATURE_NAMES))

    def test_all_values_bounded_0_to_1(self):
        # deliberately extreme/out-of-range inputs to prove clamping works,
        # not just that "normal" inputs happen to land in range
        ctx = _make_ctx(
            category_acceptance_rate={Category.TRANSPORT: 5.0},   # way out of [0,1]
            category_priority_weight={Category.TRANSPORT: -3.0},
            fatigue_level=99.0,
            category_avg_daily_kg={Category.TRANSPORT: 10_000.0},  # way above the norm cap
        )
        profile = _make_profile()
        selection = _make_selection(matched_pattern=_make_pattern(confidence=1.0))
        vector = build_context_vector(ctx, profile, selection)
        for name, value in zip(FEATURE_NAMES, vector):
            with self.subTest(feature=name):
                self.assertGreaterEqual(value, 0.0)
                self.assertLessEqual(value, 1.0)

    def test_bias_term_is_always_one(self):
        vector = build_context_vector(_make_ctx(), _make_profile(), _make_selection())
        self.assertEqual(vector[FEATURE_NAMES.index("bias")], 1.0)

    def test_pattern_confidence_reflects_matched_pattern(self):
        pattern = _make_pattern(confidence=0.82)
        selection = _make_selection(matched_pattern=pattern, matched_via="pattern_match")
        vector = build_context_vector(_make_ctx(), _make_profile(), selection)
        self.assertAlmostEqual(vector[FEATURE_NAMES.index("pattern_confidence")], 0.82)
        self.assertEqual(vector[FEATURE_NAMES.index("pattern_is_mature")], 1.0)  # 0.82 >= 0.65

    def test_pattern_confidence_defaults_to_neutral_when_no_pattern(self):
        selection = _make_selection(matched_pattern=None, matched_via="cold_start_default")
        vector = build_context_vector(_make_ctx(), _make_profile(), selection)
        self.assertAlmostEqual(vector[FEATURE_NAMES.index("pattern_confidence")], 0.5)
        self.assertEqual(vector[FEATURE_NAMES.index("pattern_is_mature")], 0.0)

    def test_tier_one_hot_is_genuinely_one_hot(self):
        for tier in ("cold", "developing", "established"):
            with self.subTest(tier=tier):
                profile = _make_profile(confidence_tier=tier)
                vector = build_context_vector(_make_ctx(), profile, _make_selection())
                tier_block = vector[FEATURE_NAMES.index("tier_cold"):FEATURE_NAMES.index("tier_established") + 1]
                self.assertEqual(sum(tier_block), 1.0)
                expected_index = ["cold", "developing", "established"].index(tier)
                self.assertEqual(tier_block[expected_index], 1.0)

    def test_matched_via_one_hot_is_genuinely_one_hot(self):
        for matched_via in ("pattern_match", "category_gap_boost", "cold_start_default"):
            with self.subTest(matched_via=matched_via):
                selection = _make_selection(matched_via=matched_via)
                vector = build_context_vector(_make_ctx(), _make_profile(), selection)
                start = FEATURE_NAMES.index("matched_via_pattern_match")
                block = vector[start:start + 3]
                self.assertEqual(sum(block), 1.0)

    def test_vector_varies_with_relevance_score(self):
        low = _make_selection(relevance_score=0.1)
        high = _make_selection(relevance_score=0.9)
        v_low = build_context_vector(_make_ctx(), _make_profile(), low)
        v_high = build_context_vector(_make_ctx(), _make_profile(), high)
        self.assertNotEqual(v_low, v_high)
        idx = FEATURE_NAMES.index("relevance_score")
        self.assertLess(v_low[idx], v_high[idx])

    def test_vector_varies_with_category_disabled(self):
        selection = _make_selection(category=Category.TRANSPORT)
        enabled_ctx = _make_ctx(disabled_categories=set())
        disabled_ctx = _make_ctx(disabled_categories={Category.TRANSPORT})
        v_enabled = build_context_vector(enabled_ctx, _make_profile(), selection)
        v_disabled = build_context_vector(disabled_ctx, _make_profile(), selection)
        idx = FEATURE_NAMES.index("category_disabled")
        self.assertEqual(v_enabled[idx], 0.0)
        self.assertEqual(v_disabled[idx], 1.0)

    def test_category_gap_score_zero_records_is_max_gap(self):
        profile = _make_profile(total_records=0, category_coverage={})
        vector = build_context_vector(_make_ctx(), profile, _make_selection())
        self.assertEqual(vector[FEATURE_NAMES.index("category_gap_score")], 1.0)

    def test_impact_band_ordinal_mapping(self):
        for band, expected in (("low", 0.0), ("medium", 0.5), ("high", 1.0)):
            with self.subTest(band=band):
                definition = _make_definition(estimated_impact_band=band)
                selection = _make_selection(definition=definition)
                vector = build_context_vector(_make_ctx(), _make_profile(), selection)
                self.assertEqual(vector[FEATURE_NAMES.index("estimated_impact_band")], expected)

    def test_no_public_function_reads_account_age_days(self):
        """Regression guard: this module must never accept account_age_days
        as a parameter on any public function -- personalization signal
        comes entirely from UserContext/DataConfidenceProfile/CandidateSelection.
        (The module docstring itself mentions the phrase "account_age_days"
        to document this design principle in prose, so this checks function
        signatures specifically rather than raw source text.)"""
        import linucb_features
        for name, func in inspect.getmembers(linucb_features, inspect.isfunction):
            if name.startswith("_"):
                continue
            params = inspect.signature(func).parameters
            self.assertNotIn(
                "account_age_days", params,
                f"{name}() must not accept account_age_days",
            )

    def test_batch_helper_matches_single_item_function(self):
        selections = [
            _make_selection(definition=_make_definition(id="A"), relevance_score=0.3),
            _make_selection(definition=_make_definition(id="B"), relevance_score=0.7),
        ]
        ctx = _make_ctx()
        profile = _make_profile()
        batch = build_context_vectors_for_selections(ctx, profile, selections)
        self.assertEqual(set(batch.keys()), {"A", "B"})
        for selection in selections:
            expected = build_context_vector(ctx, profile, selection)
            self.assertEqual(batch[selection.definition.id], expected)


if __name__ == "__main__":
    unittest.main()
