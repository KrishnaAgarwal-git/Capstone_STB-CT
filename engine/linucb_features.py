"""
LinUCB Feature Adapter
========================

Pure functions that turn what the pipeline already knows about a user and a
candidate -- UserContext, DataConfidenceProfile, CandidateSelection -- into a
fixed-length, bounded numeric context vector suitable as input to a LinUCB
contextual bandit (recommendation_engine.py: UserContext; profile_confidence.py:
DataConfidenceProfile; dynamic_candidate_generator.py: CandidateSelection).

This module does NOT implement LinUCB itself (no A/b matrices, no confidence
bounds, no arm selection) -- see `linucb.py`, this module's sibling, for
that. This is only the feature-representation boundary, built and testable
in isolation before the bandit math consumed it, per the project's "verify
the foundation before building on top of it" approach (the same reasoning
that governed wiring the dynamic candidate generator before touching
ranking). `orchestrator.py` is what actually calls this module's functions
and feeds the resulting vectors into a live `LinUCB` model.

Design principles
------------------
* Account-age-free -- this module never reads, imports, or accepts
  account_age_days anywhere. Every signal comes from UserContext (feedback
  history, fatigue, priorities), DataConfidenceProfile (data density/recency),
  or CandidateSelection (pattern match strength, category gap, definition
  metadata). Enforced by a dedicated regression test (see
  test_linucb_features.py) that inspects this module's public function
  signatures.
* Bounded output -- every feature is clamped into [0.0, 1.0] (the bias term
  is a constant 1.0). LinUCB's confidence-bound theory assumes bounded
  feature norms; an unbounded raw feature (e.g. a kg CO2e baseline) would let
  one outlier user destabilise the shared per-arm A matrix, so anything with
  an otherwise-open range is squashed with a documented, clearly-illustrative
  cap rather than passed through raw.
* No duplicated constants -- category acceptance priors and difficulty
  convenience costs are read from recommendation_engine.py's existing public
  DEFAULT_ACCEPTANCE_PRIORS / DIFFICULTY_CONVENIENCE_COST tables, not
  redefined here.
* Fixed, documented feature order -- FEATURE_NAMES is the single source of
  truth for vector layout; build_context_vector()'s length always equals
  len(FEATURE_NAMES), enforced by a test.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from profile_confidence import DataConfidenceProfile
from recommendation_engine import (
    UserContext, DEFAULT_ACCEPTANCE_PRIORS, DIFFICULTY_CONVENIENCE_COST,
)

if TYPE_CHECKING:
    from dynamic_candidate_generator import CandidateSelection


# ----------------------------------------------------------------------------
# Feature layout
# ----------------------------------------------------------------------------

# The only three values compute_data_confidence() ever returns for
# confidence_tier (see profile_confidence.py) -- fixed order for one-hot
# encoding. Not imported from profile_confidence.py because that module
# doesn't export the tier set as a constant; hardcoded here with this note
# so a change to profile_confidence.py's tier names is caught by
# test_linucb_features.py's one-hot test rather than silently producing an
# all-zero one-hot block.
_TIER_ORDER = ("cold", "developing", "established")

# The only three values CandidateSelection.matched_via ever takes (see
# dynamic_candidate_generator.py's docstring) -- fixed order for one-hot
# encoding, same reasoning as _TIER_ORDER above.
_MATCHED_VIA_ORDER = ("pattern_match", "category_gap_boost", "cold_start_default")

# Illustrative ceiling for normalising a per-user, per-category carbon
# baseline (UserContext.category_avg_daily_kg) into [0, 1] -- NOT a real
# emissions threshold, purely a squashing bound so one high-footprint user
# can't blow out the feature's assumed [0, 1] range. 10 kg CO2e/day is
# comfortably above what any single category's baseline reaches for the mock
# carbon data this pipeline currently runs on; a real Carbon Calculation
# Service may warrant recalibrating this constant.
_CATEGORY_BASELINE_KG_CAP = 10.0

FEATURE_NAMES: tuple[str, ...] = (
    "bias",
    "pattern_confidence",           # matched_pattern.confidence, or 0.5 if no match
    "pattern_is_mature",            # 1.0 if matched_pattern.is_mature else 0.0
    "relevance_score",              # CandidateSelection.relevance_score, already in [0,1]
    "category_gap_score",           # recomputed from profile -- how under-explored this category is
    "profile_overall_confidence",   # DataConfidenceProfile.overall_confidence
    "profile_completeness_score",   # DataConfidenceProfile.completeness_score
    "tier_cold",                    # one-hot over _TIER_ORDER
    "tier_developing",
    "tier_established",
    "category_acceptance_rate",     # UserContext.category_acceptance_rate, prior-filled
    "category_priority_weight",     # UserContext.category_priority_weight, default 0.5
    "fatigue_level",                # UserContext.fatigue_level
    "category_disabled",            # 1.0 if this category is in ctx.disabled_categories
    "difficulty_convenience",       # 1 - DIFFICULTY_CONVENIENCE_COST[difficulty]
    "requires_mature",              # definition.requires_mature
    "cold_start_eligible",          # definition.cold_start_eligible
    "estimated_impact_band",        # low/medium/high -> 0.0/0.5/1.0
    "matched_via_pattern_match",    # one-hot over _MATCHED_VIA_ORDER
    "matched_via_category_gap_boost",
    "matched_via_cold_start_default",
    "category_avg_daily_kg_norm",   # UserContext.category_avg_daily_kg, capped/normalised
)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _one_hot(value: str, order: tuple[str, ...]) -> list[float]:
    return [1.0 if value == candidate else 0.0 for candidate in order]


# ----------------------------------------------------------------------------
# Core function
# ----------------------------------------------------------------------------

def build_context_vector(
    ctx: UserContext,
    profile: DataConfidenceProfile,
    selection: "CandidateSelection",
) -> list[float]:
    """Build the context vector for one (user, candidate) decision point.

    Returns a list[float] of length len(FEATURE_NAMES), in the exact order
    FEATURE_NAMES documents. Every entry is in [0.0, 1.0] (see module
    docstring's "Bounded output" principle).

    This function reads NO account-age information -- personalization
    signal comes entirely from `ctx` (feedback/preference history), `profile`
    (data density/recency, itself account-age-free per profile_confidence.py),
    and `selection` (pattern match strength + the underlying
    RecommendationDefinition's own metadata).
    """
    definition = selection.definition
    category = selection.category
    matched_pattern = selection.matched_pattern

    pattern_confidence = matched_pattern.confidence if matched_pattern is not None else 0.5
    pattern_is_mature = 1.0 if (matched_pattern is not None and matched_pattern.is_mature) else 0.0

    # category_gap_score: recomputed here (not read off `selection`, which
    # only stores the final blended relevance_score) using the exact same
    # formula dynamic_candidate_generator.generate_dynamic_candidates() uses
    # internally, so this feature is a legible, separable signal a LinUCB
    # model can weight independently of the fixed 0.6/0.4 blend baked into
    # relevance_score.
    if profile.total_records == 0:
        category_gap_score = 1.0
    else:
        category_count = profile.category_coverage.get(category, 0)
        category_gap_score = 1.0 - (category_count / profile.total_records)
    category_gap_score = _clamp01(category_gap_score)

    tier_one_hot = _one_hot(profile.confidence_tier, _TIER_ORDER)

    acceptance_rate = ctx.category_acceptance_rate.get(
        category, DEFAULT_ACCEPTANCE_PRIORS.get(category, 0.35)
    )
    priority_weight = ctx.category_priority_weight.get(category, 0.5)
    category_disabled = 1.0 if category in ctx.disabled_categories else 0.0
    convenience = 1.0 - DIFFICULTY_CONVENIENCE_COST[definition.difficulty]

    impact_band_score = {"low": 0.0, "medium": 0.5, "high": 1.0}.get(
        definition.estimated_impact_band, 0.5
    )

    matched_via_one_hot = _one_hot(selection.matched_via, _MATCHED_VIA_ORDER)

    baseline_kg = ctx.category_avg_daily_kg.get(category, 0.0)
    baseline_kg_norm = _clamp01(baseline_kg / _CATEGORY_BASELINE_KG_CAP)

    vector = [
        1.0,                                    # bias
        _clamp01(pattern_confidence),
        pattern_is_mature,
        _clamp01(selection.relevance_score),
        category_gap_score,
        _clamp01(profile.overall_confidence),
        _clamp01(profile.completeness_score),
        *tier_one_hot,
        _clamp01(acceptance_rate),
        _clamp01(priority_weight),
        _clamp01(ctx.fatigue_level),
        category_disabled,
        _clamp01(convenience),
        1.0 if definition.requires_mature else 0.0,
        1.0 if definition.cold_start_eligible else 0.0,
        impact_band_score,
        *matched_via_one_hot,
        baseline_kg_norm,
    ]

    assert len(vector) == len(FEATURE_NAMES), (
        f"build_context_vector() produced {len(vector)} features, "
        f"expected {len(FEATURE_NAMES)} (FEATURE_NAMES/vector layout drifted apart)"
    )
    return vector


def build_context_vectors_for_selections(
    ctx: UserContext,
    profile: DataConfidenceProfile,
    selections: list["CandidateSelection"],
) -> dict[str, list[float]]:
    """Batch convenience wrapper: one context vector per CandidateSelection,
    keyed by the underlying RecommendationDefinition's id (the natural "arm
    id" a per-arm/disjoint LinUCB implementation will key its own A_a/b_a
    state by). Still pure feature adaptation -- no bandit math, no arm
    selection; just build_context_vector() applied per selection."""
    return {
        selection.definition.id: build_context_vector(ctx, profile, selection)
        for selection in selections
    }
