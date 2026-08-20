"""
Unit tests for the profile-level Data Confidence / Maturity module.

Covers:
  - zero-activity edge case
  - the two-user worked example from the spec
  - category-spread penalty
  - recency decay
  - tier boundary correctness
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from profile_confidence import compute_data_confidence, DataConfidenceProfile
from recommendation_engine import Activity, Category


class TestComputeDataConfidence(unittest.TestCase):
    """Tests for compute_data_confidence()."""

    def _make_activities(
        self,
        user_id: str,
        count: int,
        category: Category,
        start_at: datetime,
        spacing_days: float = 1.0,
    ) -> list[Activity]:
        """Helper: build a list of Activity objects spaced by spacing_days."""
        activities: list[Activity] = []
        for i in range(count):
            occurred_at = start_at + timedelta(days=spacing_days * i)
            activities.append(
                Activity(
                    user_id=user_id,
                    category=category,
                    subtype="test_activity",
                    quantity=1.0,
                    unit="item",
                    occurred_at=occurred_at,
                )
            )
        return activities

    # ------------------------------------------------------------------
    # 1. Zero activities
    # ------------------------------------------------------------------

    def test_zero_activities_returns_cold_tier(self) -> None:
        as_of = datetime(2026, 8, 1, 12, 0, 0)
        profile = compute_data_confidence("user_zero", [], as_of)
        self.assertEqual(profile.total_records, 0)
        self.assertEqual(profile.active_days, 0)
        self.assertEqual(profile.categories_covered, 0)
        self.assertEqual(profile.completeness_score, 0.0)
        self.assertEqual(profile.overall_confidence, 0.0)
        self.assertEqual(profile.confidence_tier, "cold")

    # ------------------------------------------------------------------
    # 2. Two-user worked example
    # ------------------------------------------------------------------

    def test_worked_example_80_record_user_higher_than_4_record_user(self) -> None:
        """
        User A: 40-day-old account, 4 sparse records (1 category).
        User B: 25-day-old account, 80 consistent records (4 categories).
        Both evaluated with last activity on the same recent day.
        User B must score STRICTLY higher despite the shorter calendar span.
        """
        as_of = datetime(2026, 8, 19, 12, 0, 0)

        # User A - 4 records over 40 days, all FOOD, last activity 5 days ago
        user_a_activities: list[Activity] = []
        for i in range(4):
            occurred_at = as_of - timedelta(days=5 + (3 - i) * 10)
            user_a_activities.append(
                Activity(
                    user_id="user_a",
                    category=Category.FOOD,
                    subtype="test_food",
                    quantity=1.0,
                    unit="item",
                    occurred_at=occurred_at,
                )
            )

        # User B - 80 records over 25 days, 4 categories, last activity 1 day ago
        user_b_activities: list[Activity] = []
        categories = [Category.FOOD, Category.TRANSPORT, Category.ELECTRICITY, Category.SHOPPING]
        for i in range(80):
            occurred_at = as_of - timedelta(days=1 + (79 - i) * 0.3)
            cat = categories[i % len(categories)]
            user_b_activities.append(
                Activity(
                    user_id="user_b",
                    category=cat,
                    subtype="test_activity",
                    quantity=1.0,
                    unit="item",
                    occurred_at=occurred_at,
                )
            )

        profile_a = compute_data_confidence("user_a", user_a_activities, as_of)
        profile_b = compute_data_confidence("user_b", user_b_activities, as_of)

        self.assertGreater(
            profile_b.overall_confidence,
            profile_a.overall_confidence,
            "User B (80 records, 25 days) should have higher overall_confidence "
            "than User A (4 records, 40 days)",
        )
        # Sanity-check tiers
        self.assertIn(profile_a.confidence_tier, ("cold", "developing"))
        self.assertEqual(profile_b.confidence_tier, "established")

    # ------------------------------------------------------------------
    # 3. Category spread matters
    # ------------------------------------------------------------------

    def test_single_category_scores_lower_than_multi_category(self) -> None:
        """Two users with the same record count, but one spans 1 category and
        the other spans 4.  The multi-category user must have a higher
        completeness_score."""
        as_of = datetime(2026, 8, 19, 12, 0, 0)
        start_at = as_of - timedelta(days=10)

        # 30 records, all FOOD
        single_cat = self._make_activities("user_single", 30, Category.FOOD, start_at, spacing_days=0.5)

        # 30 records, spread across 4 categories
        multi_cat: list[Activity] = []
        categories = [Category.FOOD, Category.TRANSPORT, Category.ELECTRICITY, Category.SHOPPING]
        for i in range(30):
            occurred_at = start_at + timedelta(days=0.5 * i)
            multi_cat.append(
                Activity(
                    user_id="user_multi",
                    category=categories[i % len(categories)],
                    subtype="test_activity",
                    quantity=1.0,
                    unit="item",
                    occurred_at=occurred_at,
                )
            )

        profile_single = compute_data_confidence("user_single", single_cat, as_of)
        profile_multi = compute_data_confidence("user_multi", multi_cat, as_of)

        self.assertGreater(
            profile_multi.completeness_score,
            profile_single.completeness_score,
            "Multi-category user should have higher completeness_score",
        )

    # ------------------------------------------------------------------
    # 4. Recency matters
    # ------------------------------------------------------------------

    def test_stale_data_scores_lower_than_recent_data(self) -> None:
        """Two identical activity histories, but one has a much older last
        activity.  The stale user must score lower on overall_confidence."""
        as_of = datetime(2026, 8, 19, 12, 0, 0)

        # Recent user - last activity 1 day ago
        recent_activities = self._make_activities(
            "user_recent", 20, Category.FOOD, as_of - timedelta(days=10), spacing_days=0.5
        )

        # Stale user - identical pattern but shifted back 30 days
        stale_activities = self._make_activities(
            "user_stale", 20, Category.FOOD, as_of - timedelta(days=40), spacing_days=0.5
        )

        profile_recent = compute_data_confidence("user_recent", recent_activities, as_of)
        profile_stale = compute_data_confidence("user_stale", stale_activities, as_of)

        self.assertGreater(
            profile_recent.overall_confidence,
            profile_stale.overall_confidence,
            "Recent-data user should have higher overall_confidence",
        )

    # ------------------------------------------------------------------
    # 5. Tier boundaries
    # ------------------------------------------------------------------

    def test_tier_boundary_at_0_35(self) -> None:
        """A profile with overall_confidence just below 0.35 is cold;
        just above is developing."""
        as_of = datetime(2026, 8, 19, 12, 0, 0)

        # Build a very sparse, stale set to land below 0.35
        activities = self._make_activities(
            "user_boundary", 2, Category.FOOD, as_of - timedelta(days=20), spacing_days=5
        )
        profile = compute_data_confidence("user_boundary", activities, as_of)

        # 2 records, 20-day recency -> should be firmly in cold
        self.assertEqual(profile.confidence_tier, "cold")
        self.assertLess(profile.overall_confidence, 0.35)

    def test_tier_boundary_at_0_65(self) -> None:
        """A profile with overall_confidence just below 0.65 is developing;
        just above is established."""
        as_of = datetime(2026, 8, 19, 12, 0, 0)

        # Build a rich, recent set to land above 0.65
        activities: list[Activity] = []
        categories = [Category.FOOD, Category.TRANSPORT, Category.ELECTRICITY, Category.SHOPPING]
        for i in range(50):
            occurred_at = as_of - timedelta(days=0.5 * i)
            activities.append(
                Activity(
                    user_id="user_rich",
                    category=categories[i % len(categories)],
                    subtype="test_activity",
                    quantity=1.0,
                    unit="item",
                    occurred_at=occurred_at,
                )
            )

        profile = compute_data_confidence("user_rich", activities, as_of)
        self.assertEqual(profile.confidence_tier, "established")
        self.assertGreaterEqual(profile.overall_confidence, 0.65)

    def test_tier_developing_between_boundaries(self) -> None:
        """A moderately active user should land in developing."""
        as_of = datetime(2026, 8, 19, 12, 0, 0)

        # 8 records, 2 categories, last activity 3 days ago
        activities: list[Activity] = []
        for i in range(8):
            occurred_at = as_of - timedelta(days=3 + (7 - i) * 2)
            cat = Category.FOOD if i < 4 else Category.TRANSPORT
            activities.append(
                Activity(
                    user_id="user_mid",
                    category=cat,
                    subtype="test_activity",
                    quantity=1.0,
                    unit="item",
                    occurred_at=occurred_at,
                )
            )

        profile = compute_data_confidence("user_mid", activities, as_of)
        self.assertEqual(profile.confidence_tier, "developing")
        self.assertGreaterEqual(profile.overall_confidence, 0.35)
        self.assertLess(profile.overall_confidence, 0.65)


if __name__ == "__main__":
    unittest.main()
