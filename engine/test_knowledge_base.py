"""
Unit tests for the Recommendation Knowledge Base.

Covers:
  - corpus size >= 100
  - validation passes with zero errors
  - all ids are unique
  - every Category enum value has at least 3 recommendations
  - every entry's category and difficulty are valid enum members
"""

from __future__ import annotations

import unittest

from knowledge_base import all_recommendations, validate_knowledge_base, RecommendationDefinition
from recommendation_engine import Category, Difficulty


class TestKnowledgeBaseCorpus(unittest.TestCase):
    """Tests against the full static recommendation corpus."""

    def test_corpus_has_at_least_100_entries(self) -> None:
        items = all_recommendations()
        self.assertGreaterEqual(
            len(items), 100, f"Expected >= 100 recommendations, got {len(items)}"
        )

    def test_validation_passes_clean(self) -> None:
        items = all_recommendations()
        problems = validate_knowledge_base(items)
        self.assertEqual(
            problems, [], f"Validation failed with problems: {problems}"
        )

    def test_all_ids_are_unique(self) -> None:
        items = all_recommendations()
        ids = [item.id for item in items]
        self.assertEqual(
            len(ids), len(set(ids)), f"Found duplicate ids: {ids}"
        )

    def test_every_category_has_at_least_three_recommendations(self) -> None:
        items = all_recommendations()
        category_counts: dict[Category, int] = {}
        for item in items:
            category_counts[item.category] = category_counts.get(item.category, 0) + 1

        for cat in Category:
            with self.subTest(category=cat.value):
                count = category_counts.get(cat, 0)
                self.assertGreaterEqual(
                    count, 3,
                    f"Category '{cat.value}' has only {count} recommendation(s), "
                    f"minimum required is 3"
                )

    def test_every_entry_has_valid_category_enum(self) -> None:
        items = all_recommendations()
        for item in items:
            with self.subTest(item_id=item.id):
                self.assertIsInstance(
                    item.category, Category,
                    f"{item.id}: category '{item.category}' is not a Category enum member"
                )

    def test_every_entry_has_valid_difficulty_enum(self) -> None:
        items = all_recommendations()
        for item in items:
            with self.subTest(item_id=item.id):
                self.assertIsInstance(
                    item.difficulty, Difficulty,
                    f"{item.id}: difficulty '{item.difficulty}' is not a Difficulty enum member"
                )


class TestValidateKnowledgeBase(unittest.TestCase):
    """Unit tests for the validation function itself."""

    def _make_valid(self, **overrides) -> RecommendationDefinition:
        defaults = {
            "id": "TEST-001",
            "category": Category.FOOD,
            "title": "Valid Title",
            "description_template": "Do {count} things.",
            "action_type": "test_action",
            "baseline_activity_key": "baseline_activity",
            "recommended_activity_key": "recommended_activity",
            "default_quantity": 1.0,
            "unit": "item",
            "difficulty": Difficulty.EASY,
            "tags": ("test",),
            "applicable_pattern_types": (),
            "cold_start_eligible": True,
            "requires_mature": False,
            "estimated_impact_band": "low",
            "conditions": {},
            "source_note": "Test source note",
        }
        defaults.update(overrides)
        return RecommendationDefinition(**defaults)

    def test_empty_list_is_valid(self) -> None:
        self.assertEqual(validate_knowledge_base([]), [])

    def test_duplicate_ids_flagged(self) -> None:
        a = self._make_valid(id="DUP-001")
        b = self._make_valid(id="DUP-001")
        problems = validate_knowledge_base([a, b])
        self.assertTrue(any("duplicate id" in p for p in problems))

    def test_empty_title_flagged(self) -> None:
        item = self._make_valid(id="BAD-001", title="")
        problems = validate_knowledge_base([item])
        self.assertTrue(any("empty title" in p for p in problems))

    def test_empty_description_flagged(self) -> None:
        item = self._make_valid(id="BAD-002", description_template="")
        problems = validate_knowledge_base([item])
        self.assertTrue(any("empty description_template" in p for p in problems))

    def test_invalid_category_flagged(self) -> None:
        item = self._make_valid(id="BAD-003", category="not_a_category")  # type: ignore[arg-type]
        problems = validate_knowledge_base([item])
        self.assertTrue(any("not a Category enum member" in p for p in problems))

    def test_invalid_difficulty_flagged(self) -> None:
        item = self._make_valid(id="BAD-004", difficulty="not_a_difficulty")  # type: ignore[arg-type]
        problems = validate_knowledge_base([item])
        self.assertTrue(any("not a Difficulty enum member" in p for p in problems))

    def test_mismatched_braces_flagged(self) -> None:
        item = self._make_valid(id="BAD-005", description_template="Missing close {brace")
        problems = validate_knowledge_base([item])
        self.assertTrue(any("mismatched braces" in p for p in problems))

    def test_invalid_impact_band_flagged(self) -> None:
        item = self._make_valid(id="BAD-006", estimated_impact_band="massive")
        problems = validate_knowledge_base([item])
        self.assertTrue(any("estimated_impact_band" in p for p in problems))

    def test_negative_quantity_flagged(self) -> None:
        item = self._make_valid(id="BAD-007", default_quantity=-5.0)
        problems = validate_knowledge_base([item])
        self.assertTrue(any("negative" in p for p in problems))

    def test_valid_item_has_no_problems(self) -> None:
        item = self._make_valid(id="GOOD-001")
        self.assertEqual(validate_knowledge_base([item]), [])


if __name__ == "__main__":
    unittest.main()
