"""
Profile-Level Data Confidence / Maturity Module
================================================

Aggregates a user’s *entire* activity history into a single profile-level
confidence score.  This is intentionally NOT a function of account age — it
is derived solely from the volume, spread, and recency of *logged* activities.

Design principles
-----------------
* Account-age-agnostic — a 40-day-old account with 4 sparse records can score
  lower than a 25-day-old account with 80 consistent records.
* Reuses existing primitives — `exponential_decay` from recommendation_engine.py
  (same half-life, same shape as `mine_pattern`).
* Bounded outputs — all scores are in [0.0, 1.0], with explicit, auditable
  formulas documented in docstrings and comments.
* Graceful degradation — zero activities returns a valid all-zero / "cold"
  profile rather than crashing or returning None.

Live in the recommendation pipeline: `orchestrator.py`'s `get_recommendations()`
and `InMemoryUserStore.get_recommendations()` both call
`compute_data_confidence()` and pass the resulting `DataConfidenceProfile`
into `dynamic_candidate_generator.generate_dynamic_candidates()` for tier
gating. It does not wire into `recommendation_engine.generate_candidates()`
(the smaller, static RULE_LIBRARY reference path, which still uses its own
original account-age gate and is no longer what the live pipeline calls).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from recommendation_engine import Activity, Category, exponential_decay


# ----------------------------------------------------------------------------
# Data model
# ----------------------------------------------------------------------------

@dataclass(frozen=True)
class DataConfidenceProfile:
    """Aggregate read on how much a user's overall data can be trusted for
    personalization.  This is a PROFILE-level signal, distinct from the
    per-pattern confidence computed by `mine_pattern()`."""
    user_id: str
    total_records: int
    active_days: int               # distinct calendar days with >=1 activity
    category_coverage: dict        # {Category: int} activity count per category
    categories_covered: int        # categories with count > 0
    date_range_days: int           # days between first and last activity, inclusive
    recency_days: float            # days since most recent activity (as of `as_of`)
    completeness_score: float      # 0.0-1.0 — volume + spread + engagement breadth
    overall_confidence: float      # 0.0-1.0 — completeness weighted by recency
    confidence_tier: str           # "cold" | "developing" | "established"


# ----------------------------------------------------------------------------
# Scoring constants
# ----------------------------------------------------------------------------

# Weights for the three sub-components of completeness_score.
# Volume is the strongest signal (more records → more patterns to mine),
# followed by category spread (breadth of lifestyle captured),
# then active_days (consistency of engagement).
_COMPLETENESS_VOLUME_WEIGHT = 0.50
_COMPLETENESS_SPREAD_WEIGHT = 0.30
_COMPLETENESS_DAYS_WEIGHT = 0.20

# Caps for the raw linear components before they are fed into completeness_score.
# These are intentionally modest — a user with 20 records across 4 categories
# over 7 active days is already well-represented.
_VOLUME_CAP = 20.0          # total_records
_ACTIVE_DAYS_CAP = 7.0      # distinct calendar days

# Weight for how much recency influences the final overall_confidence.
# Completeness is the dominant signal; recency acts as a decay multiplier
# (stale data should not be treated as confidently as recent data).
_OVERALL_COMPLETENESS_WEIGHT = 0.70
_OVERALL_RECENCY_WEIGHT = 0.30

# Tier thresholds — deliberately reuse the SAME 0.35 / 0.65 cutoffs used by
# BehaviourPattern.is_early and BehaviourPattern.is_mature in
# recommendation_engine.py, so the entire codebase speaks one language.
_TIER_COLD_THRESHOLD = 0.35
_TIER_ESTABLISHED_THRESHOLD = 0.65


# ----------------------------------------------------------------------------
# Core function
# ----------------------------------------------------------------------------

def compute_data_confidence(
    user_id: str,
    activities: list[Activity],
    as_of: datetime,
) -> DataConfidenceProfile:
    """Compute a profile-level confidence score from a user's raw activities.

    Scoring formula
    ---------------
    1. **Raw aggregates** (from the activity list):
       - total_records      = len(activities)
       - active_days        = count of distinct calendar days with >=1 record
       - category_coverage  = {Category: activity count}
       - categories_covered = count of categories with count > 0
       - date_range_days    = (last_date - first_date).days + 1, or 0 if <2 records
       - recency_days       = (as_of - most_recent_activity).total_seconds() / 86400

    2. **completeness_score** (0.0-1.0) — three sub-components, each capped:

       a) volume_score = min(total_records / _VOLUME_CAP, 1.0)
          *Rationale:* Diminishing returns after ~20 records.  A user with 80
          records is richer than one with 20, but the marginal utility for
          pattern mining flattens; the cap prevents raw volume from drowning
          out the other signals.

       b) active_days_score = min(active_days / _ACTIVE_DAYS_CAP, 1.0)
          *Rationale:* 7 distinct days of logging is enough to show habit
          consistency; beyond that the signal saturates.

       c) spread_score = categories_covered / len(Category)
          *Rationale:* A user who only ever logs transport is less
          "completely" profiled than one who logs transport, food, and
          electricity, even at identical record counts.  This is a pure
          ratio — no cap needed because len(Category) is the natural ceiling.

       completeness_score = (
           _COMPLETENESS_VOLUME_WEIGHT * volume_score
         + _COMPLETENESS_SPREAD_WEIGHT * spread_score
         + _COMPLETENESS_DAYS_WEIGHT   * active_days_score
       )

    3. **recency_factor** — reuses `exponential_decay()` from
       `recommendation_engine.py` (half_life = 21.0, same as `mine_pattern`).
       recency_factor = exponential_decay(recency_days, half_life=21.0)

    4. **overall_confidence** — weighted combination:
       overall_confidence = (
           _OVERALL_COMPLETENESS_WEIGHT * completeness_score
         + _OVERALL_RECENCY_WEIGHT    * recency_factor
       )

    5. **confidence_tier** — derived from overall_confidence:
       - "cold"        if overall_confidence < 0.35
       - "developing"  if 0.35 <= overall_confidence < 0.65
       - "established" if overall_confidence >= 0.65

    Why this is NOT the same as account age
    ----------------------------------------
    The formula above never sees an account-creation timestamp.  It only
    inspects the *logged* activity list.  Consider two users evaluated on
    the same `as_of` date:

    **User A** — 40 days of account age, but only 4 records:
      - total_records = 4
      - active_days   = 4 (one record per day, spread across 40 days)
      - categories_covered = 1
      - recency_days  = 5
      - volume_score  = min(4 / 20, 1.0) = 0.20
      - active_days_score = min(4 / 7, 1.0) ≈ 0.571
      - spread_score  = 1 / 7 ≈ 0.143
      - completeness_score = 0.50*0.20 + 0.30*0.143 + 0.20*0.571 ≈ 0.229
      - recency_factor = exp_decay(5, 21) ≈ 0.851
      - overall_confidence = 0.70*0.229 + 0.30*0.851 ≈ 0.416
      - confidence_tier = "developing" (borderline; stale recency pushes it
        toward "cold")

    **User B** — 25 days of account age, 80 consistent records:
      - total_records = 80
      - active_days   = 15
      - categories_covered = 4
      - recency_days  = 1
      - volume_score  = min(80 / 20, 1.0) = 1.0
      - active_days_score = min(15 / 7, 1.0) = 1.0
      - spread_score  = 4 / 7 ≈ 0.571
      - completeness_score = 0.50*1.0 + 0.30*0.571 + 0.20*1.0 ≈ 0.871
      - recency_factor = exp_decay(1, 21) ≈ 0.967
      - overall_confidence = 0.70*0.871 + 0.30*0.967 ≈ 0.900
      - confidence_tier = "established"

    User B scores far higher *despite* the shorter calendar span, because
    the score is driven by data density and breadth, not by how long ago
    the account was created.

    Zero-activity edge case
    -----------------------
    If `activities` is empty, all numeric fields are 0 (or 0.0) and the
    tier is "cold".  No exception is raised.
    """

    # ------------------------------------------------------------------
    # 1. Raw aggregates
    # ------------------------------------------------------------------
    total_records = len(activities)

    if total_records == 0:
        return DataConfidenceProfile(
            user_id=user_id,
            total_records=0,
            active_days=0,
            category_coverage={},
            categories_covered=0,
            date_range_days=0,
            recency_days=0.0,
            completeness_score=0.0,
            overall_confidence=0.0,
            confidence_tier="cold",
        )

    # Sort by occurred_at to make first/last extraction deterministic
    sorted_activities = sorted(activities, key=lambda a: a.occurred_at)
    first_activity = sorted_activities[0]
    last_activity = sorted_activities[-1]

    # Distinct calendar days with >=1 record
    active_days_set = {a.occurred_at.date() for a in activities}
    active_days = len(active_days_set)

    # Category coverage
    category_coverage: dict[Category, int] = {}
    for a in activities:
        category_coverage[a.category] = category_coverage.get(a.category, 0) + 1
    categories_covered = sum(1 for count in category_coverage.values() if count > 0)

    # Date range (inclusive)
    date_range_days = (last_activity.occurred_at.date() - first_activity.occurred_at.date()).days + 1

    # Recency
    recency_seconds = (as_of - last_activity.occurred_at).total_seconds()
    recency_days = max(0.0, recency_seconds / 86400.0)

    # ------------------------------------------------------------------
    # 2. completeness_score
    # ------------------------------------------------------------------
    volume_score = min(total_records / _VOLUME_CAP, 1.0)
    active_days_score = min(active_days / _ACTIVE_DAYS_CAP, 1.0)
    spread_score = categories_covered / len(Category)

    completeness_score = round(
        _COMPLETENESS_VOLUME_WEIGHT * volume_score
        + _COMPLETENESS_SPREAD_WEIGHT * spread_score
        + _COMPLETENESS_DAYS_WEIGHT * active_days_score,
        4,
    )

    # ------------------------------------------------------------------
    # 3. recency_factor
    # ------------------------------------------------------------------
    recency_factor = round(exponential_decay(recency_days, half_life=21.0), 4)

    # ------------------------------------------------------------------
    # 4. overall_confidence
    # ------------------------------------------------------------------
    overall_confidence = round(
        _OVERALL_COMPLETENESS_WEIGHT * completeness_score
        + _OVERALL_RECENCY_WEIGHT * recency_factor,
        4,
    )

    # ------------------------------------------------------------------
    # 5. confidence_tier
    # ------------------------------------------------------------------
    if overall_confidence < _TIER_COLD_THRESHOLD:
        confidence_tier = "cold"
    elif overall_confidence < _TIER_ESTABLISHED_THRESHOLD:
        confidence_tier = "developing"
    else:
        confidence_tier = "established"

    return DataConfidenceProfile(
        user_id=user_id,
        total_records=total_records,
        active_days=active_days,
        category_coverage=category_coverage,
        categories_covered=categories_covered,
        date_range_days=date_range_days,
        recency_days=round(recency_days, 2),
        completeness_score=completeness_score,
        overall_confidence=overall_confidence,
        confidence_tier=confidence_tier,
    )
