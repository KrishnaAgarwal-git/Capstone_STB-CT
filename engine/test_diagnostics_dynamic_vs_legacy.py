"""
Tests for the dynamic-vs-legacy diagnostic harness.

These are NOT tests of generate_dynamic_candidates()'s internal scoring logic
(that's covered by test_dynamic_candidate_generator.py) -- they exercise the
harness's five seeded profiles end to end, against the real 104-entry
knowledge_base corpus, and assert the specific properties the diagnostic task
called out:

  - generate_dynamic_candidates() is non-empty for every profile
  - max_per_category is respected everywhere (verified against the real
    corpus, not assumed)
  - "established_sparse" never reaches confidence_tier "established"
  - every CandidateSelection.relevance_score is in [0.0, 1.0]
"""

from __future__ import annotations

import unittest

import knowledge_base
from diagnostics_dynamic_vs_legacy import PROFILES, run_profile
from dynamic_candidate_generator import generate_dynamic_candidates


class TestDiagnosticsHarness(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Run every seeded profile once and share results across tests --
        # seeding + mining + scoring is deterministic (fixed rng_seed=42,
        # datetime.now() only affects recency, not the properties asserted
        # here) so this is safe to compute once per test run.
        cls.results = {
            name: run_profile(name, account_age_days, truncate_to)
            for name, account_age_days, truncate_to in PROFILES
        }

    def test_new_candidates_nonempty_for_every_profile(self):
        for name, result in self.results.items():
            with self.subTest(profile=name):
                self.assertGreater(
                    len(result["new_candidates"]), 0,
                    f"generate_dynamic_candidates() returned no candidates for profile {name!r}",
                )

    def test_max_per_category_respected_across_profiles(self):
        max_per_category = 8  # matches the default used by run_profile()
        for name, result in self.results.items():
            counts = result["new_by_category"]
            for category, count in counts.items():
                with self.subTest(profile=name, category=category):
                    self.assertLessEqual(
                        count, max_per_category,
                        f"profile {name!r} category {category!r} returned {count} "
                        f"candidates, exceeding max_per_category={max_per_category}",
                    )

    def test_max_per_category_cap_actually_triggers(self):
        """The cap assertion above is only meaningful if at least one category
        actually has more eligible definitions than the cap -- otherwise the
        test would pass vacuously. Verify against the real corpus, with a
        tight cap, that (a) the cap is enforced and (b) it was genuinely
        exercised (uncapped pool size > cap) for at least one category."""
        established_result = self.results["established_dense"]
        patterns = established_result["patterns"]
        profile = established_result["profile"]
        definitions = knowledge_base.all_recommendations()

        tight_cap = 2
        capped = generate_dynamic_candidates(
            "diag_established_dense", definitions, patterns, profile,
            max_per_category=tight_cap,
        )
        uncapped = generate_dynamic_candidates(
            "diag_established_dense", definitions, patterns, profile,
            max_per_category=len(definitions),  # effectively unlimited
        )

        capped_counts: dict = {}
        for c in capped:
            capped_counts[c.category] = capped_counts.get(c.category, 0) + 1
        uncapped_counts: dict = {}
        for c in uncapped:
            uncapped_counts[c.category] = uncapped_counts.get(c.category, 0) + 1

        for category, count in capped_counts.items():
            with self.subTest(category=category):
                self.assertLessEqual(count, tight_cap)

        self.assertTrue(
            any(count > tight_cap for count in uncapped_counts.values()),
            "expected at least one category's uncapped eligible pool to exceed "
            f"max_per_category={tight_cap} against the real corpus, so the cap "
            "assertion above is not vacuous; uncapped counts were "
            f"{uncapped_counts}",
        )

    def test_established_sparse_never_reaches_established_tier(self):
        profile = self.results["established_sparse"]["profile"]
        self.assertNotEqual(
            profile.confidence_tier, "established",
            "established_sparse (35-day-old account, truncated to 6 sparse "
            "activities) reached confidence_tier=='established' -- this is "
            "the key anti-account-age regression the harness exists to catch: "
            "sparse data on an old account must not score as established.",
        )

    def test_relevance_scores_bounded(self):
        for name, result in self.results.items():
            for candidate in result["new_candidates"]:
                with self.subTest(profile=name, candidate=candidate.definition.id):
                    self.assertGreaterEqual(candidate.relevance_score, 0.0)
                    self.assertLessEqual(candidate.relevance_score, 1.0)


if __name__ == "__main__":
    unittest.main()
