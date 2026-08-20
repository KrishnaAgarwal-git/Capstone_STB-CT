"""
Dynamic Candidate Generator
============================

Retrieval stage that narrows the Recommendation Knowledge Base down to a
relevant, per-user, per-category candidate pool.  This stage sits BETWEEN
the static knowledge base and the LinUCB ranker (linucb.py + linucb_features.py)
— it decides which candidates are *eligible to be considered at all*, but
does NOT attach carbon estimates or produce final rankings.

Design principles
-----------------
* Tier-gated maturity — uses DataConfidenceProfile.confidence_tier (cold /
  developing / established), NEVER account age or creation date.
* Two-stage eligibility — profile tier is necessary but not sufficient;
  requires_mature definitions additionally need an individually mature
  BehaviourPattern, mirroring the existing coarse/fine gate in
  recommendation_engine.py.
* Relevance scoring — pattern strength dominates, with a modest category-gap
  boost to surface under-explored areas.
* Per-category cap — limits how many candidates any single category can
  contribute, preventing category dominance without forcing every category
  to produce output.
* No carbon math — this stage runs before carbon estimates are attached.

Live in the recommendation pipeline: `orchestrator.py`'s `get_recommendations()`
and `InMemoryUserStore.get_recommendations()` both call
`generate_dynamic_candidates()` and pass its output to
`recommendation_engine.generate_candidates_from_selections()` for carbon
pricing. This is the actual candidate source for the live pipeline — the
smaller, static RULE_LIBRARY (`recommendation_engine.generate_candidates()`)
is retained only as a reference implementation with its own test suite.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from knowledge_base import RecommendationDefinition
from profile_confidence import DataConfidenceProfile
from recommendation_engine import BehaviourPattern, Category


# ----------------------------------------------------------------------------
# Data model
# ----------------------------------------------------------------------------

@dataclass(frozen=True)
class CandidateSelection:
    """One eligible recommendation definition, scored and matched for a
    specific user at a specific moment."""
    definition: RecommendationDefinition
    category: Category
    relevance_score: float          # 0.0-1.0
    matched_pattern: Optional[BehaviourPattern]   # None for cold-start generics
    matched_via: str                # "pattern_match" | "cold_start_default" | "category_gap_boost"


# ----------------------------------------------------------------------------
# Scoring constants
# ----------------------------------------------------------------------------

# Relevance-score weights.
# Pattern strength is the dominant signal — behavioural evidence is the best
# predictor of whether a swap recommendation is timely and actionable.
# Category gap provides diversity, preventing the candidate pool from
# collapsing into the user's already-dominant category.
_PATTERN_STRENGTH_WEIGHT = 0.60
_CATEGORY_GAP_WEIGHT = 0.40

# Default pattern strength for cold-start-eligible items that have no
# BehaviourPattern trigger.  0.5 = "no behavioural signal either way".
_DEFAULT_PATTERN_STRENGTH = 0.5


# ----------------------------------------------------------------------------
# Core function
# ----------------------------------------------------------------------------

def generate_dynamic_candidates(
    user_id: str,
    definitions: list[RecommendationDefinition],
    patterns: list[BehaviourPattern],
    profile: DataConfidenceProfile,
    max_per_category: int = 8,
) -> list[CandidateSelection]:
    """Filter and score the knowledge-base corpus for a single user.

    Eligibility gating
    ------------------
    Gating is driven by ``profile.confidence_tier`` (never account age).

    1. **"cold" tier**
       Only definitions with ``cold_start_eligible == True`` are eligible.

    2. **"developing" tier**
       Eligible if ``cold_start_eligible == True`` OR the definition's
       ``applicable_pattern_types`` intersects the set of pattern types
       actually present in ``patterns``.
       ``requires_mature`` definitions are excluded at this tier — they
       represent "big ask" recommendations that need mature user data
       overall, not just an early-stage pattern match.

    3. **"established" tier**
       Same first-stage filter as "developing".  Additionally, a definition
       with ``requires_mature == True`` is only eligible when its best-
       matching pattern (highest confidence among applicable types)
       individually satisfies ``is_mature == True``.

    Universal exclusion rule (all tiers):
       A definition whose ``applicable_pattern_types`` is non-empty, has
       no matching pattern type present in ``patterns``, and is NOT
       ``cold_start_eligible``, is never eligible.

    Relevance scoring
    -----------------
    Applied only to definitions that passed eligibility gating.

    1. **pattern_strength**
       - If a matched ``BehaviourPattern`` exists, use its ``.confidence``
         directly (already in [0, 1]).
       - If no matched pattern (cold-start generic), use
         ``_DEFAULT_PATTERN_STRENGTH = 0.5``.

    2. **category_gap**
       Measures how under-explored this candidate's category is relative
       to the user's logged history:

         If profile.total_records == 0:
             gap_score = 1.0
             # Every category is equally under-explored when no data exists.
         Else:
             category_count = profile.category_coverage.get(category, 0)
             category_share = category_count / profile.total_records
             gap_score = 1.0 - category_share

       ``gap_score`` is naturally bounded in [0.0, 1.0]:
       - 0 records in the category  -> gap_score = 1.0 (max boost)
       - 100% of records in category -> gap_score = 0.0 (no boost)

    3. **relevance_score**
       relevance_score = (
           _PATTERN_STRENGTH_WEIGHT * pattern_strength
         + _CATEGORY_GAP_WEIGHT     * gap_score
       )
       clamped to [0.0, 1.0].

    4. **matched_via**
       - "pattern_match"       if ``matched_pattern`` is not None.
       - "category_gap_boost"  if ``matched_pattern`` is None AND
                                 ``gap_score > pattern_strength``.
                                 # The recommendation is primarily driven by
                                 # category exploration rather than behaviour.
       - "cold_start_default"  otherwise.
                                 # Tie-break: gap_score == pattern_strength
                                 # falls here.

    Per-category capping
    --------------------
    After scoring, candidates are grouped by ``category``.  Each group is
    sorted by ``relevance_score`` descending and truncated to at most
    ``max_per_category``.  Categories with zero eligible definitions
    contribute nothing — no backfilling.

    Parameters
    ----------
    user_id:
        Identifier for the user (carried through for observability).
    definitions:
        Full or subset corpus of RecommendationDefinition objects to filter.
    patterns:
        Mined BehaviourPattern objects for this user.
    profile:
        DataConfidenceProfile computed from the user's activity history.
    max_per_category:
        Maximum candidates to retain per category (default 8).

    Returns
    -------
    Flattened list of CandidateSelection objects.  Each category's
    candidates are in descending relevance_score order, but the overall
    list is not globally sorted across categories.
    """

    # ------------------------------------------------------------------
    # 0. Index patterns by type for fast lookup
    # ------------------------------------------------------------------
    patterns_by_type: dict[str, list[BehaviourPattern]] = {}
    for p in patterns:
        patterns_by_type.setdefault(p.pattern_type, []).append(p)

    user_pattern_types = set(patterns_by_type.keys())

    # ------------------------------------------------------------------
    # 1. Eligibility gating + matching
    # ------------------------------------------------------------------
    eligible: list[tuple[RecommendationDefinition, Optional[BehaviourPattern]]] = []

    for definition in definitions:
        # Universal exclusion: non-empty applicable_pattern_types, no matching
        # pattern type present, and not cold-start-eligible.
        has_applicable_types = len(definition.applicable_pattern_types) > 0
        has_matching_type = bool(
            set(definition.applicable_pattern_types) & user_pattern_types
        )

        if has_applicable_types and not has_matching_type and not definition.cold_start_eligible:
            continue

        # Find the best-matching pattern (highest confidence) among applicable types.
        best_pattern: Optional[BehaviourPattern] = None
        for pt in definition.applicable_pattern_types:
            for p in patterns_by_type.get(pt, []):
                if best_pattern is None or p.confidence > best_pattern.confidence:
                    best_pattern = p

        # Tier-based eligibility
        tier = profile.confidence_tier

        if tier == "cold":
            if not definition.cold_start_eligible:
                continue

        elif tier == "developing":
            # Eligible if cold-start-safe OR a matching pattern type exists.
            # requires_mature items are reserved for the "established" tier
            # -- they represent "big ask" recommendations that need mature
            # user data overall, not just an early-stage pattern match.
            if definition.requires_mature:
                continue
            if not definition.cold_start_eligible and not has_matching_type:
                continue

        elif tier == "established":
            # First-stage: same as developing.
            if not definition.cold_start_eligible and not has_matching_type:
                continue
            # Second-stage: requires_mature needs an individually mature pattern.
            if definition.requires_mature:
                if best_pattern is None or not best_pattern.is_mature:
                    continue

        else:
            # Defensive: unknown tier treated as cold.
            if not definition.cold_start_eligible:
                continue

        eligible.append((definition, best_pattern))

    # ------------------------------------------------------------------
    # 2. Relevance scoring
    # ------------------------------------------------------------------
    scored: list[CandidateSelection] = []
    for definition, matched_pattern in eligible:
        # pattern_strength
        if matched_pattern is not None:
            pattern_strength = matched_pattern.confidence
        else:
            pattern_strength = _DEFAULT_PATTERN_STRENGTH

        # category_gap
        if profile.total_records == 0:
            gap_score = 1.0
        else:
            category_count = profile.category_coverage.get(definition.category, 0)
            category_share = category_count / profile.total_records
            gap_score = 1.0 - category_share

        gap_score = max(0.0, min(1.0, gap_score))

        # relevance_score
        relevance = round(
            _PATTERN_STRENGTH_WEIGHT * pattern_strength
            + _CATEGORY_GAP_WEIGHT * gap_score,
            4,
        )
        relevance = max(0.0, min(1.0, relevance))

        # matched_via
        if matched_pattern is not None:
            matched_via = "pattern_match"
        elif gap_score > pattern_strength:
            matched_via = "category_gap_boost"
        else:
            matched_via = "cold_start_default"

        scored.append(CandidateSelection(
            definition=definition,
            category=definition.category,
            relevance_score=relevance,
            matched_pattern=matched_pattern,
            matched_via=matched_via,
        ))

    # ------------------------------------------------------------------
    # 3. Per-category cap
    # ------------------------------------------------------------------
    by_category: dict[Category, list[CandidateSelection]] = {}
    for candidate in scored:
        by_category.setdefault(candidate.category, []).append(candidate)

    result: list[CandidateSelection] = []
    for cat in by_category:
        group = by_category[cat]
        group.sort(key=lambda c: c.relevance_score, reverse=True)
        result.extend(group[:max_per_category])

    return result
