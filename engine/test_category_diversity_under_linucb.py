"""
Task 6: category-wise selection, verified specifically under the now-blended
LinUCB ranking (see recommendation_engine.py's BLEND_WEIGHT_LINUCB and
orchestrator.py's InMemoryUserStore wiring, from the previous task).

Why this needs its own verification pass (not just re-running earlier
tests): rank_and_filter()'s category-balancing step ("at most one per
category unless too few candidates overall" -- recommendation_engine.py)
was designed and tested against pure rules-based final_score. Blending in a
LinUCB opinion could, in principle, distort that balancing in a category-
specific way, because:
  - every LinUCB arm is category-pure by construction (a RecommendationDefinition,
    and therefore its arm_id, belongs to exactly one Category -- see
    knowledge_base.py), so there's no risk of one arm's state leaking into
    another category's arms, but
  - if a user's feedback history happens to concentrate on ONE category
    (e.g. they only ever respond to electricity recommendations), that
    category's arms accumulate much more LinUCB training than every other
    category's -- does rank_and_filter's diversity step still hold once
    scores are no longer purely rules-based?

Covers:
  - a category with zero eligible candidates upstream still contributes
    nothing downstream, with LinUCB blending active (no phantom candidates)
  - the top max_per_day recommendations span distinct categories when
    enough categories have eligible candidates, both with a fresh LinUCB
    model and with one heavily trained on a single category
  - heavy, one-sided LinUCB training on a single category's arms does NOT
    let that category monopolise every slot (rank_and_filter's "one per
    category first" logic still holds)
  - category diversity holds across a simulated multi-week feedback loop,
    not just a single snapshot
  - UserContext.disabled_categories is now a HARD filter in rank_and_filter()
    (fixed in a follow-up pass after this file first shipped -- see
    TestDisabledCategoryHardFilter below): originally it was only a soft
    scoring penalty (preference_fit -> 0, one weighted term out of many),
    true before LinUCB existed and unrelated to it, reported as a finding
    rather than silently patched at the time, then fixed as its own
    explicitly-scoped follow-up once the user asked to address it
"""

from __future__ import annotations

import unittest
from collections import Counter
from datetime import datetime

import knowledge_base
import orchestrator as orch
import profile_confidence
from dynamic_candidate_generator import generate_dynamic_candidates
from linucb import LinUCB
from linucb_features import FEATURE_NAMES
from recommendation_engine import Category, FeedbackType
from reward_mapping import RECOMMENDED_ALPHA, reward_for_event_type


def _make_store():
    store = orch.InMemoryUserStore()
    store.ensure_user("u1", account_age_days=45)
    for a in orch.seed_demo_activities("u1", account_age_days=45):
        store.add_activity("u1", a)
    return store


class TestZeroEligibleCategoryStaysEmpty(unittest.TestCase):

    def test_category_absent_from_selections_never_appears_in_output(self):
        """cold_new-style user (no activities at all) -- profile_confidence
        gates most requires_mature/pattern-only definitions out, but every
        category still has SOME cold_start_eligible entries (see
        knowledge_base's real corpus), so this checks the inverse property
        precisely: whatever categories ARE absent from the upstream
        selections must stay absent from the final, LinUCB-blended output
        too -- no category should be "invented" by scoring alone."""
        client = orch.MockCarbonCalculationClient()
        model = LinUCB(n_features=len(FEATURE_NAMES), alpha=RECOMMENDED_ALPHA)

        activities: list = []  # zero activities -- cold tier
        as_of = datetime.now()
        patterns = orch.mine_patterns_from_activities(activities, as_of=as_of)
        profile = profile_confidence.compute_data_confidence("u_cold", activities, as_of)
        selections = generate_dynamic_candidates(
            "u_cold", knowledge_base.all_recommendations(), patterns, profile, max_per_category=8,
        )
        upstream_categories = {s.category for s in selections}

        notifications = orch.get_recommendations(
            user_id="u_cold", activities=activities, carbon_client=client,
            account_age_days=3, today=as_of.date(), linucb_model=model,
        )
        shown_categories = {Category(n.category) for n in notifications}
        self.assertTrue(shown_categories <= upstream_categories)


class TestCategoryDiversityHoldsUnderBlend(unittest.TestCase):

    def test_top_recommendations_span_distinct_categories_fresh_model(self):
        store = _make_store()
        client = orch.MockCarbonCalculationClient()
        recs = store.get_recommendations("u1", client)
        categories = [r.category for r in recs]
        self.assertEqual(len(categories), len(set(categories)), categories)

    def test_top_recommendations_span_distinct_categories_after_heavy_one_sided_training(self):
        """Train LinUCB hard, with only positive feedback, on every
        ELECTRICITY arm this user could see -- if diversity logic were
        broken by the blend, this is exactly the scenario that would surface
        it (electricity crowding out every other category's slot)."""
        store = _make_store()
        client = orch.MockCarbonCalculationClient()

        as_of = datetime.now()
        activities = store.get_activities("u1")
        patterns = orch.mine_patterns_from_activities(activities, as_of=as_of)
        profile = profile_confidence.compute_data_confidence("u1", activities, as_of)
        selections = generate_dynamic_candidates(
            "u1", knowledge_base.all_recommendations(), patterns, profile, max_per_category=8,
        )
        electricity_selections = [s for s in selections if s.category == Category.ELECTRICITY]
        self.assertTrue(electricity_selections, "test setup needs eligible electricity candidates")

        ctx = store.get_context("u1")
        for selection in electricity_selections:
            from linucb_features import build_context_vector
            vector = build_context_vector(ctx, profile, selection)
            for _ in range(20):
                store._linucb_model.update(
                    selection.definition.id, vector, reward_for_event_type(FeedbackType.BEHAVIOUR_CONFIRMED),
                )

        recs = store.get_recommendations("u1", client)
        categories = [r.category for r in recs]
        self.assertEqual(
            len(categories), len(set(categories)),
            f"category diversity broken after heavy electricity training: {categories}",
        )
        # electricity should still be favoured (it's now the best-trained
        # category) but must not be the ONLY category shown
        self.assertIn("electricity", categories)
        self.assertGreater(len(set(categories)), 1)


class TestCategoryDiversityAcrossSimulatedWeeks(unittest.TestCase):

    def test_diversity_and_multi_category_representation_hold_over_many_rounds(self):
        """Simulate several 'weeks' of get_recommendations + realistic mixed
        feedback (matching the project's week-over-week personalization
        framing), and check two properties hold in every round, not just a
        snapshot: (a) each round's shown categories are distinct, and
        (b) across all rounds combined, more than one category is ever
        shown -- LinUCB's blend must not collapse the whole feedback loop
        onto a single category over time.

        Feedback pattern: accept the top slot (reinforcing a real
        preference), IGNORE the rest -- NOT dismiss the rest. Dismissing
        every non-favourite slot every week is not a realistic "mixed"
        pattern: process_feedback()'s pre-existing 3-consecutive-dismissal
        auto-disable mechanism (recommendation_engine.py,
        CONSECUTIVE_DISMISSAL_SUPPRESSION_THRESHOLD) would then legitimately
        disable most categories within a handful of weeks, and once
        disabled_categories became a real hard filter (see rank_and_filter's
        fix for the soft-penalty-only gap), too few categories remain
        eligible for diversity to hold at all -- correctly, per
        rank_and_filter's own documented "unless too few candidates overall"
        exception. IGNORED is the correct feedback type for "the user didn't
        engage with this" (a much weaker signal than an active dismissal,
        per process_feedback()'s own docstring) and does not extend the
        dismissal streak, so this test's premise (a user who has one clear
        favourite but hasn't actively rejected everything else) stays valid
        for the full simulated run."""
        store = _make_store()
        client = orch.MockCarbonCalculationClient()

        all_categories_seen: Counter = Counter()
        for week in range(10):
            recs = store.get_recommendations("u1", client)
            categories = [r.category for r in recs]
            with self.subTest(week=week):
                self.assertEqual(len(categories), len(set(categories)), categories)
            all_categories_seen.update(categories)

            for i, rec in enumerate(recs):
                event = FeedbackType.ACCEPTED if i == 0 else FeedbackType.IGNORED
                store.record_feedback("u1", rec.id, event)

        self.assertGreater(
            len(all_categories_seen), 1,
            f"only one category was ever shown across 10 simulated weeks: {all_categories_seen}",
        )


class TestDisabledCategoryHardFilter(unittest.TestCase):
    """FIXED (was an open finding when this file was first written): disabling
    a category previously only zeroed preference_fit (one weighted term,
    WEIGHTS["preference_fit"] == 0.10) inside score_candidate() -- nothing
    hard-excluded a disabled category's candidates anywhere downstream.
    rank_and_filter() now has an explicit hard filter
    (`c.category not in ctx.disabled_categories`) alongside its pre-existing
    is_suppressed() check, in the same "drop regardless of score" step.

    Both halves are verified here: (1) score_candidate() ALONE still doesn't
    guarantee exclusion -- a strong LinUCB opinion or other signals can still
    push final_score above MIN_DISPLAY_SCORE even for a disabled category,
    which is exactly why a separate hard filter was needed rather than
    relying on the soft penalty to be "usually enough"; (2) rank_and_filter()
    now closes that gap end-to-end regardless of how favourably the
    candidate would otherwise have scored."""

    def test_score_candidate_alone_does_not_guarantee_exclusion(self):
        """Concrete demonstration, not a trivial tautology: take a real
        candidate that would otherwise score well (strong LinUCB opinion,
        otherwise-neutral rules-based signals), disable its category, and
        show score_candidate()'s raw final_score still clears
        MIN_DISPLAY_SCORE -- proving the hard filter added to
        rank_and_filter() is load-bearing, not redundant with the existing
        soft penalty."""
        from recommendation_engine import score_candidate, MIN_DISPLAY_SCORE

        store = _make_store()
        client = orch.MockCarbonCalculationClient()
        store.get_recommendations("u1", client)  # populate _last_candidates
        candidate = next(iter(store._last_candidates["u1"].values()))

        # Give it a maximally favourable LinUCB opinion so the scenario is
        # realistic (a category the user has responded well to before, that
        # they then disable -- not a contrived edge case).
        candidate.linucb_score = 1.0

        ctx = store.get_context("u1")
        ctx.disabled_categories = {candidate.category}
        breakdown = score_candidate(candidate, ctx, datetime.now().date())

        self.assertEqual(breakdown.preference_fit, 0.0)
        self.assertGreaterEqual(
            breakdown.final_score, MIN_DISPLAY_SCORE,
            "score_candidate() alone should still be able to clear the display "
            "threshold for a disabled category -- this is why rank_and_filter() "
            "needs its own explicit hard filter rather than relying on this "
            "soft penalty to be sufficient",
        )

    def test_rank_and_filter_excludes_the_same_candidate_end_to_end(self):
        """The fix itself: the exact scenario above, but run through
        rank_and_filter() (not score_candidate() in isolation) -- the
        disabled-category candidate must never appear in the result, despite
        having the same favourable final_score demonstrated above."""
        from recommendation_engine import rank_and_filter

        store = _make_store()
        client = orch.MockCarbonCalculationClient()
        store.get_recommendations("u1", client)
        candidate = next(iter(store._last_candidates["u1"].values()))
        candidate.linucb_score = 1.0

        ctx = store.get_context("u1")
        ctx.disabled_categories = {candidate.category}

        selected = rank_and_filter([candidate], ctx, datetime.now().date())
        self.assertEqual(selected, [])

    def test_disabled_category_never_appears_through_the_full_live_pipeline(self):
        """End-to-end confirmation through InMemoryUserStore.get_recommendations()
        (not a hand-built single-candidate scenario) -- disable a category
        that's actually being shown, then confirm it's gone next round."""
        store = _make_store()
        client = orch.MockCarbonCalculationClient()
        recs = store.get_recommendations("u1", client)
        self.assertTrue(recs)

        disabled_category = recs[0].category
        store.get_context("u1").disabled_categories = {Category(disabled_category)}

        recs_after = store.get_recommendations("u1", client)
        self.assertNotIn(disabled_category, [r.category for r in recs_after])


if __name__ == "__main__":
    unittest.main()
