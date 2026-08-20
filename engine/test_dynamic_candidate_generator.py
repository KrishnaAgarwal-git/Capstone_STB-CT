"""
Unit tests for the Dynamic Candidate Generator.

Covers:
  - tier-based eligibility gating (cold / developing / established)
  - requires_mature fine-grained gate
  - relevance_score bounded in [0, 1]
  - per-category cap
  - zero-eligible-category backfill rule (no backfilling)
  - untriggerable definitions never appear
  - function signature has no account_age_days parameter
"""

from __future__ import annotations

import inspect
import unittest
from datetime import datetime, timedelta
from typing import Optional

from dynamic_candidate_generator import generate_dynamic_candidates, CandidateSelection
from knowledge_base import RecommendationDefinition
from profile_confidence import DataConfidenceProfile
from recommendation_engine import BehaviourPattern, Category


class TestGenerateDynamicCandidates(unittest.TestCase):
    """Tests for generate_dynamic_candidates()."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _make_definition(
        self,
        id: str,
        category: Category,
        action_type: str,
        applicable_pattern_types: tuple[str, ...] = (),
        cold_start_eligible: bool = False,
        requires_mature: bool = False,
    ) -> RecommendationDefinition:
        return RecommendationDefinition(
            id=id,
            category=category,
            title=f"Title {id}",
            description_template=f"Do {action_type}.",
            action_type=action_type,
            baseline_activity_key=f"baseline_{action_type}",
            recommended_activity_key=f"recommended_{action_type}",
            default_quantity=1.0,
            unit="item",
            difficulty=None,  # type: ignore[arg-type]
            tags=("test",),
            applicable_pattern_types=applicable_pattern_types,
            cold_start_eligible=cold_start_eligible,
            requires_mature=requires_mature,
            estimated_impact_band="low",
            conditions={},
            source_note="test fixture",
        )

    def _make_pattern(
        self,
        pattern_type: str,
        confidence: float,
        occurred_at: Optional[datetime] = None,
    ) -> BehaviourPattern:
        now = occurred_at or datetime(2026, 8, 19, 12, 0, 0)
        return BehaviourPattern(
            user_id="user_test",
            pattern_type=pattern_type,
            dimensions={},
            occurrences=5,
            eligible_opportunities=10,
            confidence=confidence,
            last_observed_at=now,
            first_observed_at=now - timedelta(days=7),
        )

    def _make_profile(
        self,
        tier: str,
        total_records: int = 0,
        category_coverage: Optional[dict] = None,
    ) -> DataConfidenceProfile:
        coverage = category_coverage or {}
        categories_covered = sum(1 for v in coverage.values() if v > 0)
        return DataConfidenceProfile(
            user_id="user_test",
            total_records=total_records,
            active_days=1,
            category_coverage=coverage,
            categories_covered=categories_covered,
            date_range_days=1,
            recency_days=1.0,
            completeness_score=0.5,
            overall_confidence=0.5,
            confidence_tier=tier,
        )

    # ------------------------------------------------------------------
    # 1. Cold tier: only cold_start_eligible definitions
    # ------------------------------------------------------------------

    def test_cold_tier_only_cold_start_eligible(self) -> None:
        """At 'cold' tier, only cold_start_eligible definitions appear."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", cold_start_eligible=True),
            self._make_definition("D2", Category.FOOD, "b", applicable_pattern_types=("meal",)),
            self._make_definition("D3", Category.TRANSPORT, "c", cold_start_eligible=True),
        ]
        profile = self._make_profile("cold")
        patterns: list[BehaviourPattern] = []

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        ids = [c.definition.id for c in result]

        self.assertIn("D1", ids)
        self.assertIn("D3", ids)
        self.assertNotIn("D2", ids)

    # ------------------------------------------------------------------
    # 2. Developing tier: pattern match unlocks non-cold-start
    # ------------------------------------------------------------------

    def test_developing_tier_pattern_match_unlocks(self) -> None:
        """At 'developing' tier, a definition whose pattern type matches
        appears even if cold_start_eligible is False."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", applicable_pattern_types=("meal",)),
            self._make_definition("D2", Category.FOOD, "b", applicable_pattern_types=("meal",), requires_mature=True),
            self._make_definition("D3", Category.FOOD, "c", cold_start_eligible=True),
        ]
        # Non-mature pattern (confidence 0.45 -> is_early, not is_mature)
        patterns = [self._make_pattern("meal", confidence=0.45)]
        profile = self._make_profile("developing", total_records=10, category_coverage={Category.FOOD: 10})

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        ids = [c.definition.id for c in result]

        # D1 unlocked by pattern match
        self.assertIn("D1", ids)
        # D3 always eligible (cold-start)
        self.assertIn("D3", ids)
        # D2 requires_mature -> excluded because pattern is not mature
        self.assertNotIn("D2", ids)

    # ------------------------------------------------------------------
    # 3. Established tier with mature pattern: requires_mature now appears
    # ------------------------------------------------------------------

    def test_established_tier_mature_pattern_unlocks_requires_mature(self) -> None:
        """At 'established' tier, a requires_mature definition appears when
        its matching pattern is individually mature (confidence >= 0.65)."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", applicable_pattern_types=("meal",), requires_mature=True),
            self._make_definition("D2", Category.FOOD, "b", applicable_pattern_types=("meal",)),
        ]
        # Mature pattern (confidence 0.75)
        patterns = [self._make_pattern("meal", confidence=0.75)]
        profile = self._make_profile("established", total_records=10, category_coverage={Category.FOOD: 10})

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        ids = [c.definition.id for c in result]

        self.assertIn("D1", ids)
        self.assertIn("D2", ids)

    # ------------------------------------------------------------------
    # 4. Established tier with non-mature pattern: requires_mature still excluded
    # ------------------------------------------------------------------

    def test_established_tier_non_mature_pattern_keeps_requires_mature_excluded(self) -> None:
        """Even at 'established' tier, requires_mature is excluded if the
        best-matching pattern is not mature."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", applicable_pattern_types=("meal",), requires_mature=True),
        ]
        # Non-mature pattern (confidence 0.55)
        patterns = [self._make_pattern("meal", confidence=0.55)]
        profile = self._make_profile("established", total_records=10, category_coverage={Category.FOOD: 10})

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        ids = [c.definition.id for c in result]

        self.assertNotIn("D1", ids)

    # ------------------------------------------------------------------
    # 5. Per-category cap
    # ------------------------------------------------------------------

    def test_per_category_cap_respected(self) -> None:
        """Only the top max_per_category candidates per category are kept."""
        defs = [
            self._make_definition(f"D{i}", Category.FOOD, f"a{i}", cold_start_eligible=True)
            for i in range(12)
        ]
        profile = self._make_profile("cold", total_records=0)
        patterns: list[BehaviourPattern] = []

        result = generate_dynamic_candidates("user", defs, patterns, profile, max_per_category=5)
        food_count = sum(1 for c in result if c.category == Category.FOOD)

        self.assertLessEqual(food_count, 5)
        # Verify descending order within category
        food_scores = [c.relevance_score for c in result if c.category == Category.FOOD]
        self.assertEqual(food_scores, sorted(food_scores, reverse=True))

    # ------------------------------------------------------------------
    # 6. Zero-eligible category produces no entries
    # ------------------------------------------------------------------

    def test_zero_eligible_category_not_backfilled(self) -> None:
        """A category with zero eligible definitions contributes nothing."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", cold_start_eligible=True),
        ]
        profile = self._make_profile("cold", total_records=0)
        patterns: list[BehaviourPattern] = []

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        categories_present = {c.category for c in result}

        self.assertIn(Category.FOOD, categories_present)
        self.assertNotIn(Category.TRANSPORT, categories_present)

    # ------------------------------------------------------------------
    # 7. Relevance scores bounded
    # ------------------------------------------------------------------

    def test_relevance_scores_within_bounds(self) -> None:
        """Every returned relevance_score is in [0.0, 1.0]."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", cold_start_eligible=True),
            self._make_definition("D2", Category.TRANSPORT, "b", applicable_pattern_types=("commute",)),
        ]
        patterns = [self._make_pattern("commute", confidence=0.9)]
        profile = self._make_profile("developing", total_records=100, category_coverage={Category.FOOD: 100})

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        for c in result:
            self.assertGreaterEqual(c.relevance_score, 0.0)
            self.assertLessEqual(c.relevance_score, 1.0)

    # ------------------------------------------------------------------
    # 8. Function signature rejects account_age_days
    # ------------------------------------------------------------------

    def test_signature_has_no_account_age_parameter(self) -> None:
        """generate_dynamic_candidates must not accept account_age_days."""
        sig = inspect.signature(generate_dynamic_candidates)
        param_names = list(sig.parameters.keys())

        for name in param_names:
            self.assertNotIn("account_age", name.lower())
            self.assertNotIn("age_days", name.lower())

    # ------------------------------------------------------------------
    # 9. Untriggerable definition never appears
    # ------------------------------------------------------------------

    def test_untriggerable_definition_never_appears(self) -> None:
        """A definition with empty applicable_pattern_types and
        cold_start_eligible=False has no trigger path."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", applicable_pattern_types=(), cold_start_eligible=False),
        ]
        profile = self._make_profile("established", total_records=10)
        patterns: list[BehaviourPattern] = []

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        self.assertEqual(len(result), 0)

    # ------------------------------------------------------------------
    # 10. matched_via values are correct
    # ------------------------------------------------------------------

    def test_matched_via_pattern_match(self) -> None:
        """A definition matched by a pattern gets matched_via='pattern_match'."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", applicable_pattern_types=("meal",)),
        ]
        patterns = [self._make_pattern("meal", confidence=0.6)]
        profile = self._make_profile("developing", total_records=10, category_coverage={Category.FOOD: 10})

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].matched_via, "pattern_match")
        self.assertIsNotNone(result[0].matched_pattern)

    def test_matched_via_cold_start_default(self) -> None:
        """A cold-start item in a well-explored category gets
        matched_via='cold_start_default'."""
        defs = [
            self._make_definition("D1", Category.FOOD, "a", cold_start_eligible=True),
        ]
        profile = self._make_profile("cold", total_records=100, category_coverage={Category.FOOD: 100})
        patterns: list[BehaviourPattern] = []

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].matched_via, "cold_start_default")

    def test_matched_via_category_gap_boost(self) -> None:
        """A cold-start item in an under-explored category gets
        matched_via='category_gap_boost'."""
        defs = [
            self._make_definition("D1", Category.TRANSPORT, "a", cold_start_eligible=True),
        ]
        # All records are in FOOD; TRANSPORT is completely under-explored
        profile = self._make_profile("cold", total_records=100, category_coverage={Category.FOOD: 100})
        patterns: list[BehaviourPattern] = []

        result = generate_dynamic_candidates("user", defs, patterns, profile)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].matched_via, "category_gap_boost")


if __name__ == "__main__":
    unittest.main()
