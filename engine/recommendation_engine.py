"""
Personalised Carbon Recommendation Engine — Reference Implementation
======================================================================

This is a working, runnable implementation of the core algorithm described in
`02-recommendation-algorithm.md`. It is a self-contained reference module (no
external DB required — uses in-memory dataclasses) intended to demonstrate the
exact math and control flow that a production service would implement against
Postgres, and to serve as the basis for unit tests.

Scope covered:
  - Carbon Calculation Service integration (external API client — this module
    NEVER computes emissions locally; see CarbonCalculationClient)
  - Behaviour pattern mining (confidence scoring from occurrence/recency/consistency)
  - Candidate generation (cold-start / early / mature rule tiers)
  - Multi-objective candidate scoring
  - Anti-spam / cooldown / fatigue / category-balancing filters
  - Explanation trace generation (structured, not LLM-based)
  - Feedback processing (acceptance-probability + suppression updates)

Run `python recommendation_engine.py` to see a worked demo matching the
chicken -> paneer example from the spec.

Architectural note on carbon calculation
----------------------------------------
The Carbon Calculation Service is an existing external service (see
`01-overview-and-architecture.md` §3 and `04-api-design.md` §1/§9). This
module never computes kg CO2e itself — it only ever consumes a result object
already produced by that service, via `CarbonCalculationClient`. Every place
that used to do `quantity * factor.value` locally now takes a precomputed
`CarbonEstimate` instead. This preserves the rest of the pipeline (scoring,
ranking, anti-spam, explainability) exactly as before — those components
only ever cared about the resulting kg CO2e numbers, not how they were derived.
"""

from __future__ import annotations

import math
import statistics
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, date
from enum import Enum
from typing import Optional, Protocol, TYPE_CHECKING

if TYPE_CHECKING:
    # Type-hint-only import (this module uses `from __future__ import
    # annotations`, so this never executes at runtime) -- avoids a real
    # circular import, since dynamic_candidate_generator.py itself imports
    # this module.
    from dynamic_candidate_generator import CandidateSelection


# ----------------------------------------------------------------------------
# Domain enums
# ----------------------------------------------------------------------------

class Category(str, Enum):
    FOOD = "food"
    TRANSPORT = "transport"
    ELECTRICITY = "electricity"
    WATER = "water"
    SHOPPING = "shopping"
    WASTE = "waste"
    LIFESTYLE = "lifestyle"


class Difficulty(str, Enum):
    EASY = "easy"
    MODERATE = "moderate"
    CHALLENGING = "challenging"


class TriggerType(str, Enum):
    RULE = "rule"
    PATTERN = "pattern"
    MODEL = "model"


class FeedbackType(str, Enum):
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"
    IGNORED = "ignored"
    PARTIALLY_COMPLETED = "partially_completed"
    BEHAVIOUR_CONFIRMED = "behaviour_confirmed"
    BEHAVIOUR_UNCHANGED = "behaviour_unchanged"


# ----------------------------------------------------------------------------
# Carbon Calculation Service integration (external service, API-only)
# ----------------------------------------------------------------------------
#
# The Carbon Calculation Service already exists outside this module (see
# `01-overview-and-architecture.md` §3, `04-api-design.md` §1/§9). This engine
# integrates with it only through CarbonCalculationClient — it never re-derives
# kg CO2e from a raw emission-factor value itself. EmissionFactor below is
# therefore just a *reference/citation* record (what factor was used, and its
# source/version, for display + audit), not something this module multiplies.

@dataclass(frozen=True)
class EmissionFactor:
    """A citation record describing which emission factor the external
    Carbon Calculation Service used. Carried for display/audit purposes only —
    never used by this module to compute emissions."""
    factor_key: str
    unit: str                 # e.g. "kg_co2e_per_kg"
    source: str
    version: str
    region_code: str = "GLOBAL"


@dataclass(frozen=True)
class CarbonEstimate:
    """The result of a Carbon Calculation Service API call for one activity
    quantity. This is the *only* way emissions enter this module — nothing
    downstream (scoring, ranking, explanation) ever computes kg CO2e itself,
    it only reads these fields."""
    activity_key: str
    quantity: float
    unit: str
    co2e_kg: float
    emission_factor: EmissionFactor
    calculation_confidence: float = 1.0


class CarbonCalculationClient(Protocol):
    """Integration seam for the external Carbon Calculation Service.
    Any concrete client (HTTP, gRPC, or a test double) implements this
    interface. The rest of the engine only ever depends on this protocol,
    never on a concrete transport."""

    def estimate(self, activity_key: str, quantity: float, unit: str,
                 region_code: str = "GLOBAL") -> CarbonEstimate:
        ...


class HttpCarbonCalculationClient:
    """Production client: calls the external Carbon Calculation Service's
    REST API (the same service backing `POST /api/v1/activities` and
    `POST /api/v1/recommendations/preview` in `04-api-design.md`).

    Intentionally thin: this class's only job is the HTTP call + response
    mapping into a CarbonEstimate. It must not contain any emissions math —
    that logic belongs entirely to the external service.
    """

    def __init__(self, base_url: str, http_session=None, timeout_seconds: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        if http_session is not None:
            self._session = http_session
        else:
            import requests  # local import: keep `requests` optional for pure-offline usage
            self._session = requests.Session()

    def estimate(self, activity_key: str, quantity: float, unit: str,
                 region_code: str = "GLOBAL") -> CarbonEstimate:
        response = self._session.post(
            f"{self.base_url}/api/v1/recommendations/preview",
            json={
                "baseline_activity": activity_key,
                "baseline_quantity": quantity,
                "unit": unit,
                "region_code": region_code,
                "candidate_alternatives": [],
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()

        factor_info = payload.get("emission_factor", {})
        factor = EmissionFactor(
            factor_key=activity_key,
            unit=factor_info.get("unit", "kg_co2e_per_kg"),
            source=factor_info.get("source", payload.get("factor_source", "unknown")),
            version=factor_info.get("version", "unknown"),
            region_code=region_code,
        )
        return CarbonEstimate(
            activity_key=activity_key,
            quantity=quantity,
            unit=unit,
            co2e_kg=payload["baseline_emissions_kg"],
            emission_factor=factor,
            calculation_confidence=payload.get("calculation_confidence", 1.0),
        )


class InMemoryCarbonCalculationClient:
    """Test/demo double implementing the same CarbonCalculationClient protocol
    as the production HTTP client, so unit tests and the demo script can run
    without a live external service. Backed by a small lookup table rather
    than any formula of its own — swapping this for HttpCarbonCalculationClient
    requires no changes anywhere else in the module.

    Factors are keyed by (activity_key, region_code) so activities whose
    real-world emissions depend on local context -- most notably EVs, whose
    footprint depends on the regional electricity generation mix (per the
    project proposal's Methodology Section 5, "Electric Vehicle Handling and
    Environmental Adjustment") -- can be registered with different values per
    region without needing a different activity_key per region."""

    def __init__(self, factor_table: Optional[dict] = None):
        # factor_table: {(activity_key, region_code): (value_per_unit, source, version, unit)}
        self._table = factor_table or {}

    def register(self, activity_key: str, value_per_unit: float, source: str,
                 version: str, unit: str = "kg_co2e_per_kg", region_code: str = "GLOBAL"):
        self._table[(activity_key, region_code)] = (value_per_unit, source, version, unit)

    def estimate(self, activity_key: str, quantity: float, unit: str,
                 region_code: str = "GLOBAL") -> CarbonEstimate:
        key = (activity_key, region_code)
        if key not in self._table:
            # fall back to a GLOBAL-registered factor for this activity if no
            # region-specific one was registered -- mirrors how a real
            # emission-factor provider typically defaults to a global average
            # when it lacks region-specific data (see `emission_factors` table,
            # `03-database-schema.sql`, region_code default 'GLOBAL').
            key = (activity_key, "GLOBAL")
        if key not in self._table:
            raise KeyError(
                f"No emission factor registered for '{activity_key}' "
                f"(region '{region_code}' or GLOBAL fallback). "
                f"In production this call goes to the external Carbon Calculation "
                f"Service; this in-memory double only knows about pre-registered keys."
            )
        value_per_unit, source, version, factor_unit = self._table[key]
        co2e_kg = round(quantity * value_per_unit, 4)
        factor = EmissionFactor(
            factor_key=activity_key, unit=factor_unit, source=source,
            version=version, region_code=region_code,
        )
        return CarbonEstimate(
            activity_key=activity_key, quantity=quantity, unit=unit,
            co2e_kg=co2e_kg, emission_factor=factor, calculation_confidence=0.9,
        )


# ----------------------------------------------------------------------------
# Core data structures
# ----------------------------------------------------------------------------

@dataclass
class Activity:
    user_id: str
    category: Category
    subtype: str
    quantity: float
    unit: str
    occurred_at: datetime


@dataclass
class BehaviourPattern:
    user_id: str
    pattern_type: str
    dimensions: dict
    occurrences: int
    eligible_opportunities: int
    confidence: float
    last_observed_at: datetime
    first_observed_at: datetime

    @property
    def is_mature(self) -> bool:
        return self.confidence >= 0.65

    @property
    def is_early(self) -> bool:
        return 0.35 <= self.confidence < 0.65


@dataclass
class ScoreBreakdown:
    carbon_savings: float
    acceptance_probability: float
    pattern_confidence: float
    context_relevance: float
    preference_fit: float
    convenience: float
    category_priority: float
    fatigue_penalty: float
    repetition_penalty: float
    final_score: float
    peer_relevance: float = 0.0  # 0 when no peer-group data available (graceful degradation)
    linucb_component: Optional[float] = None  # normalised LinUCB opinion (see
        # _normalize_linucb_score); None when no LinUCB score was attached to
        # this candidate this round -- final_score is then the unblended
        # rules-based score exactly, same as before LinUCB existed.


@dataclass
class RecommendationCandidate:
    """
    NOTE on carbon numbers: `baseline_estimate` and `recommended_estimate` are
    CarbonEstimate objects obtained from the external Carbon Calculation
    Service (via a CarbonCalculationClient) *before* this object is
    constructed. This class performs no emissions math of its own beyond
    taking the difference/percentage of numbers the external service already
    computed. Convenience properties below mirror the old flat field names
    (baseline_activity, baseline_quantity, etc.) so scoring/ranking/
    explanation code that reads those names keeps working unchanged.
    """
    id: str
    user_id: str
    category: Category
    action_type: str
    title: str
    description: str
    difficulty: Difficulty
    trigger_type: TriggerType
    source_pattern: Optional[BehaviourPattern]
    baseline_estimate: CarbonEstimate
    recommended_estimate: CarbonEstimate
    tradeoff_note: Optional[str] = None
    weekly_occurrence_rate: float = 1.0  # from pattern base_rate, used for projections

    # Set at construction time only by generate_candidates_from_selections()
    # (None for the RULE_LIBRARY path, which has no knowledge_base.py
    # definition to reference) -- lets a caller that also has the originating
    # CandidateSelection (e.g. orchestrator.py, which builds LinUCB context
    # vectors from it) join back from a priced candidate to its source
    # definition, without this module needing to import anything about LinUCB.
    knowledge_base_definition_id: Optional[str] = None

    # Set post-construction by a caller that has a trained LinUCB model
    # available (e.g. orchestrator.py) -- see score_candidate()'s "LinUCB
    # blend" section below. None (the default) means no LinUCB opinion was
    # computed for this candidate this round, and score_candidate() falls
    # back to its pre-existing, unblended rules-based final_score exactly.
    linucb_score: Optional[float] = None

    # Populated in __post_init__ / by scoring
    saved_kg_co2e: float = field(init=False, default=0.0)
    percent_reduction: float = field(init=False, default=0.0)
    estimate_confidence: float = field(init=False, default=0.0)
    score_breakdown: Optional[ScoreBreakdown] = field(init=False, default=None)

    def __post_init__(self):
        # Difference/percentage of numbers already computed by the external
        # Carbon Calculation Service — no local emissions math performed here.
        self.saved_kg_co2e = round(
            self.baseline_estimate.co2e_kg - self.recommended_estimate.co2e_kg, 4
        )
        self.percent_reduction = round(
            (self.saved_kg_co2e / self.baseline_estimate.co2e_kg * 100)
            if self.baseline_estimate.co2e_kg > 0 else 0.0,
            1,
        )
        self.estimate_confidence = round(
            (self.baseline_estimate.calculation_confidence
             + self.recommended_estimate.calculation_confidence) / 2,
            3,
        )

    # --- convenience read-only accessors preserving prior flat field names ---
    @property
    def baseline_activity(self) -> str:
        return self.baseline_estimate.activity_key

    @property
    def baseline_quantity(self) -> float:
        return self.baseline_estimate.quantity

    @property
    def baseline_factor(self) -> EmissionFactor:
        return self.baseline_estimate.emission_factor

    @property
    def baseline_emissions_kg(self) -> float:
        return self.baseline_estimate.co2e_kg

    @property
    def recommended_activity(self) -> str:
        return self.recommended_estimate.activity_key

    @property
    def recommended_quantity(self) -> float:
        return self.recommended_estimate.quantity

    @property
    def recommended_factor(self) -> EmissionFactor:
        return self.recommended_estimate.emission_factor

    @property
    def recommended_emissions_kg(self) -> float:
        return self.recommended_estimate.co2e_kg


@dataclass(frozen=True)
class SavingsProjection:
    """Habit-frequency-adjusted daily/weekly/monthly/yearly saving, per
    `02-recommendation-algorithm.md` Section 2.4. Deliberately NOT a naive
    daily_saving * 7/30/365 multiplication -- a once-a-week habit should not
    be projected as if it happens every day."""
    daily_kg: float
    weekly_kg: float
    monthly_kg: float
    yearly_kg: float


def project_savings(candidate: "RecommendationCandidate") -> SavingsProjection:
    """
    Weekly/monthly/yearly saving = daily saving scaled by the pattern's own
    observed weekly occurrence rate, not a flat multiplier. Matches
    `02-recommendation-algorithm.md` Section 2.4 and is what backs the
    `weekly_projected_kg` / `monthly_projected_kg` fields in the
    `GET /recommendations/today` response (`04-api-design.md` Section 2).
    """
    daily = candidate.saved_kg_co2e
    weekly = round(daily * candidate.weekly_occurrence_rate, 4)
    monthly = round(weekly * 4.345, 4)   # avg weeks per month
    yearly = round(weekly * 52, 4)
    return SavingsProjection(daily_kg=daily, weekly_kg=weekly, monthly_kg=monthly, yearly_kg=yearly)


def weekly_occurrence_rate_from_pattern(pattern: Optional["BehaviourPattern"]) -> float:
    """
    Derive expected weekly occurrences from a mined pattern's own base rate
    (occurrences / eligible_opportunities), per Section 2.4: "expected
    occurrences per week comes directly from the mined pattern's base rate."
    Falls back to 1.0 when there's no pattern yet (cold start), since generic
    recommendations aren't tied to a specific weekly cadence.
    """
    if pattern is None or pattern.eligible_opportunities == 0:
        return 1.0
    base_rate = pattern.occurrences / pattern.eligible_opportunities
    # For a day-of-week pattern, eligible_opportunities already counts how many
    # times that weekday occurred in the window, so base_rate directly
    # approximates occurrences-per-week for that weekday slot.
    return round(max(0.0, min(7.0, base_rate)), 4)


# ----------------------------------------------------------------------------
# 1. Behaviour Pattern Mining
# ----------------------------------------------------------------------------

def exponential_decay(days_since: float, half_life: float = 21.0) -> float:
    """Recency weighting — a pattern not observed recently contributes less."""
    return math.pow(0.5, days_since / half_life)


def coefficient_of_variation(gaps: list[float]) -> float:
    if len(gaps) < 2:
        return 0.0
    mean = statistics.mean(gaps)
    if mean == 0:
        return 0.0
    stdev = statistics.pstdev(gaps)
    return stdev / mean


def mine_pattern(
    user_id: str,
    pattern_type: str,
    dimensions: dict,
    matching_activities: list[Activity],
    eligible_opportunities: int,
    as_of: datetime,
) -> Optional[BehaviourPattern]:
    """
    Compute confidence for a single candidate pattern dimension-combination.
    Mirrors Part 2 §1.2 of the design doc.
    """
    if eligible_opportunities == 0 or not matching_activities:
        return None

    matching_activities = sorted(matching_activities, key=lambda a: a.occurred_at)
    occurrences = len(matching_activities)

    base_rate = occurrences / eligible_opportunities

    days_since_last = (as_of - matching_activities[-1].occurred_at).total_seconds() / 86400
    recency = exponential_decay(days_since_last, half_life=21.0)

    if occurrences >= 2:
        gaps = [
            (matching_activities[i].occurred_at - matching_activities[i - 1].occurred_at).total_seconds() / 86400
            for i in range(1, len(matching_activities))
        ]
        consistency = max(0.0, 1 - coefficient_of_variation(gaps))
    else:
        consistency = 0.5  # neutral — not enough data to judge consistency

    confidence = max(0.0, min(1.0, base_rate * recency * consistency))

    if confidence < 0.35:
        return None  # discarded as noise per threshold rule

    return BehaviourPattern(
        user_id=user_id,
        pattern_type=pattern_type,
        dimensions=dimensions,
        occurrences=occurrences,
        eligible_opportunities=eligible_opportunities,
        confidence=round(confidence, 4),
        last_observed_at=matching_activities[-1].occurred_at,
        first_observed_at=matching_activities[0].occurred_at,
    )


# ----------------------------------------------------------------------------
# 1.5 Candidate Generation (cold-start / early / mature rule tiers)
# ----------------------------------------------------------------------------
#
# Implements the mode-switching design from `01-overview-and-architecture.md`
# Section 5: NOT three separate pipelines, but one generation pass gated by
# each pattern's own confidence, per category. A user can simultaneously be
# "mature" for transport and "cold" for shopping.
#
# This function is intentionally a thin rule *dispatcher* -- it looks up a
# small static rule table (RULE_LIBRARY) rather than hardcoding swap logic
# per category, so adding a new swap rule does not require touching the
# generation, scoring, or ranking code paths.

@dataclass(frozen=True)
class SwapRule:
    """One entry in the rule library: describes a possible baseline-to-
    recommended swap for a given category, independent of any one user."""
    action_type: str
    category: Category
    title: str
    description_template: str      # may reference {baseline}/{recommended}
    baseline_activity_key: str
    recommended_activity_key: str
    default_quantity: float
    unit: str
    difficulty: Difficulty
    tradeoff_note: Optional[str] = None
    applicable_pattern_types: tuple = ()   # pattern_type values this rule can trigger from
    cold_start_eligible: bool = False      # safe to show with zero personal history
    requires_mature: bool = False          # only trigger from a pattern at BehaviourPattern.is_mature
        # (confidence >= 0.65) -- for rules whose recommended_activity_key is a bigger ask
        # (EV, a new commute mode entirely) where showing it off a barely-qualifying pattern
        # would be exactly the "over-personalize from insufficient data" failure mode: making
        # what reads as a confident claim about someone's habits from thin evidence. Rules
        # that are a small, low-commitment nudge stay ungated -- normal early-tier matching
        # (any pattern >= 0.35) is the right bar for those, same as before this flag existed.


# Static rule library -- see `02-recommendation-algorithm.md` Section "Recommendation
# types to support" for the full category coverage this mirrors. Kept small and
# illustrative here (one or two representative rules per category); a production
# system loads this from a rules table/config, not a Python literal, but the
# *shape* of each rule stays the same.
RULE_LIBRARY: list[SwapRule] = [
    SwapRule(
        action_type="chicken_to_paneer", category=Category.FOOD,
        title="Skip Chicken Today",
        description_template="Replace today's chicken meal with paneer.",
        baseline_activity_key="chicken_curry_cooked", recommended_activity_key="paneer_curry_cooked",
        default_quantity=0.35, unit="kg", difficulty=Difficulty.EASY,
        tradeoff_note="Similar protein content, lower iron -- pair with greens if needed.",
        applicable_pattern_types=("meal_day_of_week",),
    ),
    SwapRule(
        action_type="chicken_to_lentils", category=Category.FOOD,
        title="Try Lentils Instead",
        description_template="Replace today's chicken meal with a lentil dish.",
        baseline_activity_key="chicken_curry_cooked", recommended_activity_key="lentil_curry_cooked",
        default_quantity=0.35, unit="kg", difficulty=Difficulty.EASY,
        tradeoff_note="Plant-based protein -- slightly different texture.",
        applicable_pattern_types=("meal_day_of_week",),
    ),
    # --- Transportation: covers the vehicle taxonomy from the proposal's
    # methodology (private car, two-wheeler, auto-rickshaw, public transit,
    # shared/carpool ride, EV). Tracking/verification of *which* mode a trip
    # actually used (GPS, QR, timestamps) is out of scope here -- that is the
    # backend's job. This engine only decides what to *recommend* given a
    # baseline mode already logged, matching the "AI/Logic Implementation"
    # role split (recommendation logic, not trip verification).
    SwapRule(
        action_type="solo_car_to_carpool", category=Category.TRANSPORT,
        title="Carpool to Work",
        description_template="Share today's commute instead of driving solo.",
        baseline_activity_key="car_solo_commute", recommended_activity_key="car_carpool_commute",
        default_quantity=6.0, unit="km", difficulty=Difficulty.MODERATE,
        tradeoff_note="Requires coordinating with someone -- less flexible timing.",
        applicable_pattern_types=("transport_weekday",),
    ),
    SwapRule(
        action_type="solo_car_to_public_transit", category=Category.TRANSPORT,
        title="Try Public Transport",
        description_template="Use a bus or metro instead of driving for a short trip.",
        baseline_activity_key="car_solo_commute", recommended_activity_key="bus_commute",
        default_quantity=6.0, unit="km", difficulty=Difficulty.EASY,
        tradeoff_note="May take a little longer depending on your route.",
        applicable_pattern_types=("transport_weekday",), cold_start_eligible=True,
    ),
    SwapRule(
        action_type="solo_car_to_metro", category=Category.TRANSPORT,
        title="Take the Metro Instead",
        description_template="Use the metro instead of driving for today's trip.",
        baseline_activity_key="car_solo_commute", recommended_activity_key="metro_commute",
        default_quantity=6.0, unit="km", difficulty=Difficulty.EASY,
        tradeoff_note="Needs a nearby station -- check your route first.",
        applicable_pattern_types=("transport_weekday",),
    ),
    SwapRule(
        action_type="two_wheeler_to_public_transit", category=Category.TRANSPORT,
        title="Swap the Two-Wheeler for the Bus",
        description_template="Use public transport instead of your two-wheeler today.",
        baseline_activity_key="two_wheeler_solo_commute", recommended_activity_key="bus_commute",
        default_quantity=6.0, unit="km", difficulty=Difficulty.EASY,
        tradeoff_note="Slightly less door-to-door convenience.",
        applicable_pattern_types=("transport_weekday",),
    ),
    SwapRule(
        action_type="auto_rickshaw_to_public_transit", category=Category.TRANSPORT,
        title="Try the Bus Instead of an Auto",
        description_template="Use public transport instead of an auto-rickshaw for this trip.",
        baseline_activity_key="auto_rickshaw_commute", recommended_activity_key="bus_commute",
        default_quantity=6.0, unit="km", difficulty=Difficulty.EASY,
        tradeoff_note="Usually cheaper too, just a bit less direct.",
        applicable_pattern_types=("transport_weekday",),
    ),
    SwapRule(
        action_type="solo_car_to_ev", category=Category.TRANSPORT,
        title="Consider an EV for This Route",
        description_template="An electric vehicle would cut emissions on this regular route.",
        baseline_activity_key="car_solo_commute", recommended_activity_key="ev_solo_commute",
        default_quantity=6.0, unit="km", difficulty=Difficulty.CHALLENGING,
        tradeoff_note="Higher upfront cost -- savings depend on your local electricity grid mix.",
        applicable_pattern_types=("transport_weekday",), requires_mature=True,
    ),
    SwapRule(
        action_type="standby_to_off", category=Category.ELECTRICITY,
        title="Cut the Standby Drain",
        description_template="Switch off devices instead of leaving them on standby tonight.",
        baseline_activity_key="standby_power_overnight", recommended_activity_key="devices_off_overnight",
        default_quantity=1.0, unit="kwh", difficulty=Difficulty.EASY,
        applicable_pattern_types=("energy_time_of_day",), cold_start_eligible=True,
    ),
    SwapRule(
        action_type="single_use_to_reusable", category=Category.WASTE,
        title="Carry a Reusable Bottle",
        description_template="Swap single-use plastic bottles for a reusable one today.",
        baseline_activity_key="single_use_plastic_bottle", recommended_activity_key="reusable_bottle_use",
        default_quantity=1.0, unit="item", difficulty=Difficulty.EASY,
        applicable_pattern_types=(), cold_start_eligible=True,
    ),
]


def _rules_for_tier(cold_start: bool, pattern_types_present: set) -> list[SwapRule]:
    """Select which rules are eligible given the user's current data maturity.

    This is a first, coarse pass on pattern *type* only (does the user have
    any pattern of the right type at all) -- generate_candidates then applies
    a second, finer pass per-rule using that specific matching pattern's own
    confidence (requires_mature), so a barely-qualifying pattern and a strong
    one don't unlock identical candidate sets even when both pass this
    coarse filter."""
    if cold_start:
        return [r for r in RULE_LIBRARY if r.cold_start_eligible]
    # early/mature: any rule whose applicable_pattern_types intersects what
    # we've actually mined for this user, plus cold-start-safe generic rules
    # (a mature user can still legitimately see "carry a reusable bottle").
    return [
        r for r in RULE_LIBRARY
        if r.cold_start_eligible or (set(r.applicable_pattern_types) & pattern_types_present)
    ]


def generate_candidates(
    user_id: str,
    patterns: list[BehaviourPattern],
    carbon_client: CarbonCalculationClient,
    account_age_days: int,
    region_code: str = "GLOBAL",
) -> list[RecommendationCandidate]:
    """
    Produce the wide candidate set for one user for one generation run.

    Mode selection follows `01-overview-and-architecture.md` Section 5: this
    is gated by data availability, not a single global flag --
      - cold start (< 7 days OR no patterns at all): only cold_start_eligible rules
      - early/mature: rules matched against whichever patterns exist, gated in
        two stages -- _rules_for_tier() first checks the user has *some*
        pattern of the applicable type, then the requires_mature check below
        additionally requires that specific matching pattern to have crossed
        is_mature (confidence >= 0.65) for rules flagged that way -- so an
        early-tier pattern (0.35-0.65) unlocks ordinary matching rules but not
        the bigger-ask ones yet, and generation genuinely varies with how
        strong the evidence is, not just whether a pattern exists at all.

    All carbon numbers come from `carbon_client.estimate(...)` -- an external
    Carbon Calculation Service call -- never from local arithmetic.
    """
    is_cold_start = account_age_days < 7 or len(patterns) == 0
    pattern_by_type: dict[str, list[BehaviourPattern]] = {}
    for p in patterns:
        pattern_by_type.setdefault(p.pattern_type, []).append(p)

    eligible_rules = _rules_for_tier(is_cold_start, set(pattern_by_type.keys()))

    candidates: list[RecommendationCandidate] = []
    for rule in eligible_rules:
        # find the strongest matching pattern for this rule, if any
        matching_pattern: Optional[BehaviourPattern] = None
        for pt in rule.applicable_pattern_types:
            for p in pattern_by_type.get(pt, []):
                if matching_pattern is None or p.confidence > matching_pattern.confidence:
                    matching_pattern = p

        # a rule tied to pattern types but with no mined pattern for this user
        # (and not itself cold-start-eligible) has nothing to trigger it
        if rule.applicable_pattern_types and matching_pattern is None and not rule.cold_start_eligible:
            continue

        # requires_mature rules need the matching pattern itself to have
        # crossed the mature confidence bar (>=0.65, BehaviourPattern.is_mature)
        # -- an early-tier pattern (0.35-0.65) can unlock the ordinary matching
        # rules for its pattern type, but not this bigger-ask one yet. This is
        # what actually gives is_mature/is_early a caller: confidence, not just
        # pattern *existence*, now gates which rules are eligible.
        if rule.requires_mature and not (matching_pattern and matching_pattern.is_mature):
            continue

        candidate = _price_and_build_candidate(
            user_id=user_id, category=rule.category, action_type=rule.action_type,
            title=rule.title, description_template=rule.description_template,
            baseline_activity_key=rule.baseline_activity_key,
            recommended_activity_key=rule.recommended_activity_key,
            default_quantity=rule.default_quantity, unit=rule.unit,
            difficulty=rule.difficulty, tradeoff_note=rule.tradeoff_note,
            matching_pattern=matching_pattern, carbon_client=carbon_client,
            region_code=region_code,
        )
        if candidate is not None:
            candidates.append(candidate)

    return candidates


def _price_and_build_candidate(
    user_id: str,
    category: Category,
    action_type: str,
    title: str,
    description_template: str,
    baseline_activity_key: str,
    recommended_activity_key: str,
    default_quantity: float,
    unit: str,
    difficulty: Difficulty,
    tradeoff_note: Optional[str],
    matching_pattern: Optional[BehaviourPattern],
    carbon_client: CarbonCalculationClient,
    region_code: str,
    knowledge_base_definition_id: Optional[str] = None,
) -> Optional[RecommendationCandidate]:
    """Shared candidate-construction step -- prices one baseline/recommended
    activity pair through the external Carbon Calculation Service and builds
    the resulting RecommendationCandidate. Used by both generate_candidates()
    (the static RULE_LIBRARY path, above) and generate_candidates_from_selections()
    (the dynamic candidate generator / knowledge-base path, below), so carbon
    pricing and RecommendationCandidate construction exist in exactly one
    place rather than being duplicated per candidate source.

    Returns None (caller skips the candidate) when the Carbon Calculation
    Service has no factor for this activity/region -- never guesses at a
    number, per the "never invent emission factors" requirement in
    `01-overview-and-architecture.md` assumption 3.
    """
    try:
        baseline_estimate = carbon_client.estimate(
            baseline_activity_key, default_quantity, unit, region_code
        )
        recommended_estimate = carbon_client.estimate(
            recommended_activity_key, default_quantity, unit, region_code
        )
    except KeyError:
        return None

    trigger_type = TriggerType.PATTERN if matching_pattern else TriggerType.RULE
    return RecommendationCandidate(
        id=str(uuid.uuid4()),
        user_id=user_id,
        category=category,
        action_type=action_type,
        title=title,
        description=description_template,
        difficulty=difficulty,
        trigger_type=trigger_type,
        source_pattern=matching_pattern,
        baseline_estimate=baseline_estimate,
        recommended_estimate=recommended_estimate,
        tradeoff_note=tradeoff_note,
        weekly_occurrence_rate=weekly_occurrence_rate_from_pattern(matching_pattern),
        knowledge_base_definition_id=knowledge_base_definition_id,
    )


def generate_candidates_from_selections(
    user_id: str,
    selections: list["CandidateSelection"],
    carbon_client: CarbonCalculationClient,
    region_code: str = "GLOBAL",
) -> list[RecommendationCandidate]:
    """
    Candidate-generation entry point for the dynamic candidate generator /
    104-entry knowledge-base pipeline (see `dynamic_candidate_generator.py`
    and `knowledge_base.py`). This is the live counterpart to
    generate_candidates() above -- the smaller, static RULE_LIBRARY path is
    retained (its own test suite still exercises it directly) but is no
    longer what orchestrator.py's live recommendation path calls.

    Eligibility and relevance scoring already happened upstream, in
    generate_dynamic_candidates() -- tier-gated by DataConfidenceProfile
    (data density/recency), never by account age. This function's only job
    is the same one generate_candidates() does for RULE_LIBRARY entries:
    turn each already-selected CandidateSelection into a priced
    RecommendationCandidate via the Carbon Calculation Service, using the
    SAME _price_and_build_candidate helper above -- no duplicated carbon-math
    or candidate-construction logic between the two pipelines.

    RecommendationDefinition (knowledge_base.py) has no tradeoff_note field
    (unlike SwapRule) -- passed through as None; render_explanation_text and
    scoring both already treat a None tradeoff_note as "nothing to show".
    """
    candidates: list[RecommendationCandidate] = []
    for selection in selections:
        definition = selection.definition
        candidate = _price_and_build_candidate(
            user_id=user_id, category=definition.category, action_type=definition.action_type,
            title=definition.title, description_template=definition.description_template,
            baseline_activity_key=definition.baseline_activity_key,
            recommended_activity_key=definition.recommended_activity_key,
            default_quantity=definition.default_quantity, unit=definition.unit,
            difficulty=definition.difficulty, tradeoff_note=None,
            matching_pattern=selection.matched_pattern, carbon_client=carbon_client,
            region_code=region_code, knowledge_base_definition_id=definition.id,
        )
        if candidate is not None:
            candidates.append(candidate)

    return candidates


# ----------------------------------------------------------------------------
# 2. Scoring
# ----------------------------------------------------------------------------

# Default weights — Part 2 §3.1
WEIGHTS = {
    "carbon_savings": 0.25,
    "acceptance_probability": 0.20,
    "pattern_confidence": 0.15,
    "context_relevance": 0.12,
    "preference_fit": 0.10,
    "convenience": 0.07,
    "category_priority": 0.05,
    "peer_relevance": 0.06,   # new: friend-group awareness, per proposal's core thesis
                              # (small trusted-network dynamics over global comparison).
                              # Weight taken from convenience/category_priority so the
                              # total still sums to 1.0; 0 when no peer_group data exists.
}

MIN_DISPLAY_SCORE = 0.45
MIN_CONFIDENCE_FOR_SPECIFIC_CLAIM = 0.5

# ----------------------------------------------------------------------------
# 2.1 LinUCB blend (optional -- see RecommendationCandidate.linucb_score)
# ----------------------------------------------------------------------------
#
# How much a LinUCB opinion carries once one exists for a candidate, relative
# to the existing rules-based final_score above -- a genuine blend, not a
# replacement: when candidate.linucb_score is None (the default -- e.g. every
# RULE_LIBRARY-path candidate, or any caller that hasn't wired a trained
# LinUCB model in yet), score_candidate() below produces EXACTLY the same
# final_score it always has, unaffected by anything in this section.
#
# 0.3 (LinUCB gets 30% of the blended score, the existing rules-based score
# keeps 70%) is a deliberately conservative starting point, not a claim of
# optimality: LinUCB starts with zero evidence for every arm, while the
# rules-based score already encodes carbon savings, acceptance history,
# pattern confidence, fatigue, and cooldowns that LinUCB doesn't yet weigh as
# well on its own. This balance is expected to shift (or LinUCB to take over
# entirely) once it has accumulated enough real feedback to be trusted more --
# that is a future decision, not one this task makes unilaterally.
BLEND_WEIGHT_LINUCB = 0.3


def _normalize_linucb_score(raw_score: float) -> float:
    """Map a raw LinUCB UCB score (linucb.py's score_arm() -- predicted_mean
    plus an exploration bonus; predicted_mean is bounded by
    reward_mapping.py's [-1, 1] reward range, the exploration bonus is >= 0
    and typically modest at reward_mapping.RECOMMENDED_ALPHA) onto this
    module's existing [0, 1] score convention: -1 -> 0.0 (worst), 0 -> 0.5
    (neutral -- matching this codebase's existing "0.5 = no opinion either
    way" convention, e.g. peer_relevance's neutral default, dynamic_candidate_
    generator.py's _DEFAULT_PATTERN_STRENGTH), +1 -> 1.0 (best). Clamped
    because the exploration-bonus term can push the raw score slightly above
    what the reward range alone would produce."""
    return max(0.0, min(1.0, (raw_score + 1.0) / 2.0))

# Global cold-start acceptance priors by category — Part 2 §3.2
DEFAULT_ACCEPTANCE_PRIORS = {
    Category.FOOD: 0.42,
    Category.TRANSPORT: 0.31,
    Category.ELECTRICITY: 0.55,
    Category.SHOPPING: 0.22,
    Category.WASTE: 0.48,
    Category.WATER: 0.50,
    Category.LIFESTYLE: 0.40,
}

DIFFICULTY_CONVENIENCE_COST = {
    Difficulty.EASY: 0.1,
    Difficulty.MODERATE: 0.4,
    Difficulty.CHALLENGING: 0.75,
}


@dataclass(frozen=True)
class PeerAction:
    """One observed action within the user's friend group -- e.g. 'Krishna
    carpools this route on weekdays'. Deliberately minimal: just enough to
    drive a recommendation nudge, not a full activity record (the group's
    own activity/privacy rules are the Backend/Time-Bank team's concern, not
    this engine's)."""
    peer_display_name: str
    category: Category
    action_type: str
    frequency_per_week: float


@dataclass(frozen=True)
class PeerGroupContext:
    """
    Friend-group data this engine can use to make recommendations
    group-aware, per the proposal's core thesis that engagement is driven by
    small trusted networks (5-50 members) rather than global comparison.

    This is intentionally a plain data contract, not tied to how the group
    data gets produced -- it can be:
      (a) pre-aggregated and handed to this engine by the backend/time-bank
          service (e.g. a `GET /groups/{id}/peer-summary` call it makes), or
      (b) computed by this engine itself from raw multi-user activity logs,
          via `aggregate_peer_group_context()` below,
    exactly the same pattern used for CarbonCalculationClient: define the
    contract now, decide the producer later without changing scoring/ranking.
    """
    group_id: str
    group_avg_category_kg: dict            # {Category: float} -- group's average daily footprint per category
    user_avg_category_kg: dict             # {Category: float} -- this user's own average, for comparison
    peer_actions: list                     # list[PeerAction] -- notable recurring peer behaviours
    group_size: int = 0


def aggregate_peer_group_context(
    group_id: str,
    member_activities: dict,   # {user_id: list[Activity]}
    this_user_id: str,
    window_days: int = 28,
) -> PeerGroupContext:
    """
    Option (b) above: compute PeerGroupContext directly from raw per-member
    activity logs, for use before/without a dedicated backend aggregation
    endpoint. Kept deliberately simple (averages + top recurring peer
    actions) -- if the backend later exposes pre-aggregated group stats,
    callers should build PeerGroupContext directly from that response instead
    and skip this function entirely; nothing downstream cares which path
    produced the object.
    """
    def _category_totals(activities: list) -> dict:
        totals: dict = {}
        counts: dict = {}
        for a in activities:
            totals[a.category] = totals.get(a.category, 0.0) + a.quantity
            counts[a.category] = counts.get(a.category, 0) + 1
        # NOTE: this is a quantity average, not a kg CO2e average -- converting
        # to kg CO2e requires the external Carbon Calculation Service, which
        # this aggregation step deliberately does not call (keeps this function
        # a pure, carbon-math-free aggregator, consistent with the rest of the
        # engine never computing emissions itself).
        return {cat: totals[cat] / max(1, counts[cat]) for cat in totals}

    group_totals: dict = {}
    group_counts: dict = {}
    peer_actions: list[PeerAction] = []

    for member_id, activities in member_activities.items():
        member_avgs = _category_totals(activities)
        for cat, avg in member_avgs.items():
            group_totals[cat] = group_totals.get(cat, 0.0) + avg
            group_counts[cat] = group_counts.get(cat, 0) + 1

        if member_id != this_user_id:
            # surface simple recurring-action signals for peers (e.g. "does
            # transport_weekday activities often") -- deliberately coarse;
            # richer peer pattern-mining can reuse mine_pattern() per-member
            # if/when that granularity is wanted.
            by_category_count: dict = {}
            for a in activities:
                by_category_count[a.category] = by_category_count.get(a.category, 0) + 1
            for cat, count in by_category_count.items():
                weekly_freq = round(count / max(1, window_days / 7), 2)
                if weekly_freq >= 1.0:  # only surface reasonably frequent peer behaviours
                    peer_actions.append(PeerAction(
                        peer_display_name=member_id, category=cat,
                        action_type=f"{cat.value}_activity", frequency_per_week=weekly_freq,
                    ))

    group_avg = {cat: group_totals[cat] / max(1, group_counts[cat]) for cat in group_totals}
    user_avg = _category_totals(member_activities.get(this_user_id, []))

    return PeerGroupContext(
        group_id=group_id,
        group_avg_category_kg=group_avg,
        user_avg_category_kg=user_avg,
        peer_actions=peer_actions,
        group_size=len(member_activities),
    )


@dataclass
class UserContext:
    """Everything needed to score a candidate for a specific user at a specific moment."""
    user_id: str
    category_acceptance_rate: dict  # {Category: float}, from feedback history; falls back to priors
    category_priority_weight: dict  # {Category: float 0-1}, from stated goal
    disabled_categories: set
    dietary_constraints: set
    fatigue_level: float  # 0-1, derived from recent ignore/dismiss rate
    recent_action_fingerprints: dict  # {fingerprint: last_shown_datetime}
    recent_rejected_fingerprints: dict  # {fingerprint: last_rejected_datetime}
    peer_group: Optional[PeerGroupContext] = None  # None = no group data available; degrades gracefully
    category_avg_daily_kg: dict = field(default_factory=dict)  # {Category: float}, from this
        # user's OWN logged carbon history (see aggregate_user_carbon_baseline) -- what a
        # "typical day" in this category actually costs THIS user. Empty dict (the default)
        # means no baseline has been computed yet for any category, e.g. a brand-new user;
        # normalise_carbon_savings falls back to a documented global scale per-category in
        # that case, exactly like peer_relevance degrades to neutral when peer_group is None.


def acceptance_probability(candidate: RecommendationCandidate, ctx: UserContext) -> float:
    rate = ctx.category_acceptance_rate.get(candidate.category)
    if rate is None:
        rate = DEFAULT_ACCEPTANCE_PRIORS.get(candidate.category, 0.35)
    return max(0.02, min(0.98, rate))


def aggregate_user_carbon_baseline(
    activities: list[Activity],
    carbon_client: CarbonCalculationClient,
    region_code: str = "GLOBAL",
    window_days: int = 28,
    as_of: Optional[datetime] = None,
) -> dict:
    """
    Compute this user's own average daily kg CO2e per category from their
    real logged activity history, for use as UserContext.category_avg_daily_kg.

    This is what score_candidate's carbon_savings term should be normalised
    against (see normalise_carbon_savings) instead of a fixed constant --
    the same 2kg saving means something different to a low-footprint user
    than a high-footprint one, and this function is what makes that
    comparison real rather than assumed.

    Every co2e_kg figure comes from carbon_client.estimate(...), exactly like
    generate_candidates() -- this function never multiplies quantity by a
    factor itself, consistent with the rest of the engine never computing
    emissions locally (see module docstring). Unlike
    aggregate_peer_group_context's _category_totals (a deliberately
    carbon-math-free quantity average), this one *does* call the carbon
    client, because the whole point here is a real kg CO2e baseline, not a
    quantity proxy for one.

    Activities outside `window_days` of `as_of` are ignored, so the baseline
    reflects the user's *recent* typical footprint rather than being diluted
    by very old data -- consistent with mine_pattern's own recency framing.
    An activity_key the Carbon Calculation Service has no factor for is
    skipped (mirrors generate_candidates' KeyError handling) rather than
    guessed at.

    Returns {} for a user with no relevant activity in the window -- callers
    (e.g. _demo(), or wherever UserContext is assembled in production) should
    pass this straight through as UserContext.category_avg_daily_kg;
    normalise_carbon_savings already handles an empty/missing category
    per-key via its documented fallback, so no special-casing is needed here.
    """
    as_of = as_of or datetime.now()
    cutoff = as_of - timedelta(days=window_days)
    recent = [a for a in activities if a.occurred_at >= cutoff]

    totals: dict = {}   # {Category: running sum of co2e_kg}
    days_seen: dict = {}  # {Category: set of dates with >=1 logged activity}

    for a in recent:
        try:
            estimate = carbon_client.estimate(a.subtype, a.quantity, a.unit, region_code)
        except KeyError:
            continue  # no factor for this activity -- skip rather than guess
        totals[a.category] = totals.get(a.category, 0.0) + estimate.co2e_kg
        days_seen.setdefault(a.category, set()).add(a.occurred_at.date())

    # average per ACTIVE day (days with at least one logged activity in this
    # category), not per calendar day in the window -- a category logged on
    # only 3 of 28 days should be compared to "what a typical day of this
    # behaviour costs", not diluted by the 25 days it wasn't logged at all.
    return {
        cat: round(totals[cat] / max(1, len(days_seen[cat])), 4)
        for cat in totals
    }


def normalise_carbon_savings(saved_kg: float, user_category_avg_daily_kg: float) -> float:
    """Normalise savings relative to the user's own typical category footprint,
    so a 2kg saving means something different for a low-footprint vs high-footprint user.

    user_category_avg_daily_kg should come from UserContext.category_avg_daily_kg,
    which in turn comes from aggregate_user_carbon_baseline() run against this
    user's real activity history -- see score_candidate, which is the only caller."""
    if user_category_avg_daily_kg <= 0:
        return min(1.0, saved_kg / 5.0)  # fallback global scale -- no baseline yet
        # for this category (new user / sparse data), same spirit as peer_relevance's
        # neutral default when peer_group is None: degrade gracefully, don't guess.
    return max(0.0, min(1.0, saved_kg / user_category_avg_daily_kg))


def preference_fit(candidate: RecommendationCandidate, ctx: UserContext) -> float:
    if candidate.category in ctx.disabled_categories:
        return 0.0
    # crude dietary conflict check for food candidates
    if candidate.category == Category.FOOD and "vegetarian" in ctx.dietary_constraints:
        if any(meat in candidate.recommended_activity.lower() for meat in ("chicken", "beef", "pork", "fish")):
            return 0.0
    return 1.0


def context_relevance(candidate: RecommendationCandidate, today: date) -> float:
    """Is *today* the right day for this recommendation, based on its source pattern."""
    if candidate.source_pattern is None:
        return 0.7  # generic/cold-start recommendations are always moderately relevant
    dims = candidate.source_pattern.dimensions
    if "day_of_week" in dims:
        return 1.0 if dims["day_of_week"] == today.weekday() else 0.4
    return 0.8


def peer_relevance(candidate: RecommendationCandidate, ctx: UserContext) -> float:
    """
    How much this recommendation is reinforced by the user's friend group --
    the proposal's stated differentiator (small trusted networks, not global
    comparison). Degrades gracefully to a neutral 0.5 when no PeerGroupContext
    is available, so scoring behaves identically to before this feature existed
    for any caller that doesn't yet supply peer data.

    Two independent signals, averaged -- each individually defaults to neutral
    (0.5) when its own underlying data is absent, so a strong single signal
    isn't diluted toward 0 just because the *other* signal has no data (e.g.
    the group tracks category averages but hasn't logged specific peer
    actions yet, or vice versa):
      - peer_action_alignment: do peers in the group frequently do the
        *recommended* action already? (social proof -- "your friends already
        do this") boosts relevance above neutral; no matching peer-action
        data leaves this signal at neutral, not zero.
      - relative_standing: is the user's own category footprint above the
        group average? (a recommendation in a category where the user lags
        their friend group is more timely than one where they're already
        ahead of the pack); missing group/user averages leaves this signal
        at neutral too.
    """
    group = ctx.peer_group
    if group is None:
        return 0.5  # neutral -- no group data, no opinion either way

    peer_action_alignment = 0.5  # neutral default: no peer-action data for this category
    matching_peers = [
        p for p in group.peer_actions
        if p.category == candidate.category
    ]
    if matching_peers:
        # more peers doing something in this category, more often -> stronger signal
        avg_freq = sum(p.frequency_per_week for p in matching_peers) / len(matching_peers)
        peer_action_alignment = max(0.0, min(1.0, avg_freq / 5.0))  # cap at 5x/week -> 1.0

    relative_standing = 0.5
    group_avg = group.group_avg_category_kg.get(candidate.category)
    user_avg = group.user_avg_category_kg.get(candidate.category)
    if group_avg is not None and user_avg is not None and group_avg > 0:
        # user_avg > group_avg -> lagging behind friends -> more relevant nudge
        ratio = user_avg / group_avg
        relative_standing = max(0.0, min(1.0, (ratio - 0.5)))  # ~0 at half of group avg, ~1 at 1.5x

    return round((peer_action_alignment + relative_standing) / 2, 4)


def fingerprint(user_id: str, category: Category, action_type: str) -> str:
    return f"{user_id}:{category.value}:{action_type}"


def fatigue_penalty(ctx: UserContext) -> float:
    return ctx.fatigue_level * 0.3  # scaled subtractive penalty, caps contribution


def repetition_penalty(candidate: RecommendationCandidate, ctx: UserContext, cooldown_days: int = 3) -> float:
    fp = fingerprint(candidate.user_id, candidate.category, candidate.action_type)
    last_shown = ctx.recent_action_fingerprints.get(fp)
    if last_shown is None:
        return 0.0
    days_since = (datetime.now() - last_shown).total_seconds() / 86400
    if days_since >= cooldown_days:
        return 0.0
    return 0.5 * (1 - days_since / cooldown_days)  # linear penalty inside cooldown window


def is_suppressed(candidate: RecommendationCandidate, ctx: UserContext, rejection_cooldown_days: int = 14) -> bool:
    fp = fingerprint(candidate.user_id, candidate.category, candidate.action_type)
    last_rejected = ctx.recent_rejected_fingerprints.get(fp)
    if last_rejected is None:
        return False
    days_since = (datetime.now() - last_rejected).total_seconds() / 86400
    return days_since < rejection_cooldown_days


def score_candidate(
    candidate: RecommendationCandidate,
    ctx: UserContext,
    today: date,
) -> ScoreBreakdown:
    # Real per-user, per-category baseline (see aggregate_user_carbon_baseline)
    # instead of a fixed constant -- falls back to 0 (-> normalise_carbon_savings'
    # own documented global-scale fallback) only when this category has no
    # baseline yet, e.g. a brand-new user with no relevant history.
    user_category_avg_daily_kg = ctx.category_avg_daily_kg.get(candidate.category, 0.0)
    carbon = normalise_carbon_savings(candidate.saved_kg_co2e, user_category_avg_daily_kg)
    accept_prob = acceptance_probability(candidate, ctx)
    pattern_conf = candidate.source_pattern.confidence if candidate.source_pattern else 0.5
    ctx_rel = context_relevance(candidate, today)
    pref_fit = preference_fit(candidate, ctx)
    convenience = 1 - DIFFICULTY_CONVENIENCE_COST[candidate.difficulty]
    cat_priority = ctx.category_priority_weight.get(candidate.category, 0.5)
    fatigue = fatigue_penalty(ctx)
    repetition = repetition_penalty(candidate, ctx)
    peer_rel = peer_relevance(candidate, ctx)

    rules_based_final = (
        WEIGHTS["carbon_savings"] * carbon
        + WEIGHTS["acceptance_probability"] * accept_prob
        + WEIGHTS["pattern_confidence"] * pattern_conf
        + WEIGHTS["context_relevance"] * ctx_rel
        + WEIGHTS["preference_fit"] * pref_fit
        + WEIGHTS["convenience"] * convenience
        + WEIGHTS["category_priority"] * cat_priority
        + WEIGHTS["peer_relevance"] * peer_rel
        - fatigue
        - repetition
    )
    rules_based_final = max(0.0, min(1.0, rules_based_final))

    # LinUCB blend (see BLEND_WEIGHT_LINUCB above) -- a no-op, byte-for-byte
    # reproduction of the pre-LinUCB final_score whenever candidate.linucb_score
    # is None (nothing upstream computed one this round).
    if candidate.linucb_score is not None:
        linucb_component = _normalize_linucb_score(candidate.linucb_score)
        final = (1 - BLEND_WEIGHT_LINUCB) * rules_based_final + BLEND_WEIGHT_LINUCB * linucb_component
        final = max(0.0, min(1.0, final))
    else:
        linucb_component = None
        final = rules_based_final

    candidate.estimate_confidence = round((pattern_conf + ctx_rel) / 2, 3)

    return ScoreBreakdown(
        carbon_savings=round(carbon, 3),
        acceptance_probability=round(accept_prob, 3),
        pattern_confidence=round(pattern_conf, 3),
        context_relevance=round(ctx_rel, 3),
        preference_fit=round(pref_fit, 3),
        convenience=round(convenience, 3),
        category_priority=round(cat_priority, 3),
        fatigue_penalty=round(fatigue, 3),
        repetition_penalty=round(repetition, 3),
        final_score=round(final, 4),
        peer_relevance=round(peer_rel, 3),
        linucb_component=round(linucb_component, 4) if linucb_component is not None else None,
    )


# ----------------------------------------------------------------------------
# 2.5 Feedback Loop
# ----------------------------------------------------------------------------
#
# Implements `02-recommendation-algorithm.md` Section 6.2. Mutates the same
# UserContext object that scoring/ranking read from (category_acceptance_rate,
# recent_rejected_fingerprints, fatigue_level) so a call to process_feedback
# is immediately reflected in the next rank_and_filter call for that user --
# no separate "apply feedback" step needed downstream.

# Delta applied to a category's acceptance-probability estimate per event type.
# Magnitudes mirror `02-recommendation-algorithm.md` Section 6.2's example
# deltas (accepted: +0.08, dismissed: -0.12, ignored: -0.03), extended to
# cover all FeedbackType values.
FEEDBACK_DELTA: dict[FeedbackType, float] = {
    FeedbackType.ACCEPTED: 0.08,
    FeedbackType.DISMISSED: -0.12,
    FeedbackType.IGNORED: -0.03,
    FeedbackType.PARTIALLY_COMPLETED: 0.03,
    FeedbackType.BEHAVIOUR_CONFIRMED: 0.12,   # strongest positive signal
    FeedbackType.BEHAVIOUR_UNCHANGED: -0.05,  # accepted but didn't follow through
}

CONSECUTIVE_DISMISSAL_SUPPRESSION_THRESHOLD = 3
SOFT_SUPPRESSION_DAYS = 30


@dataclass
class FeedbackEvent:
    user_id: str
    recommendation_id: str
    category: Category
    action_type: str
    event_type: FeedbackType
    occurred_at: datetime = field(default_factory=datetime.now)


def _recency_weight(event: FeedbackEvent, as_of: Optional[datetime] = None) -> float:
    """More recent feedback moves the estimate more than stale feedback --
    reuses the same exponential-decay shape as pattern recency (Section 1),
    with a longer half-life since feedback is a slower-moving signal."""
    as_of = as_of or datetime.now()
    days_since = max(0.0, (as_of - event.occurred_at).total_seconds() / 86400)
    return exponential_decay(days_since, half_life=45.0)


def process_feedback(
    event: FeedbackEvent,
    ctx: UserContext,
    consecutive_dismissals_by_category: dict,
) -> None:
    """
    Update UserContext in place from one feedback event, per
    `02-recommendation-algorithm.md` Section 6.2:
      - acceptance_probability nudged by FEEDBACK_DELTA, scaled by recency
      - dismissals start/refresh a rejection cooldown (via recent_rejected_fingerprints)
      - 3 consecutive dismissals in a category triggers soft-suppression
        (modelled here as disabling the category for SOFT_SUPPRESSION_DAYS --
        callers wanting a time-bounded suppression should clear
        `disabled_categories` for this category after that window elapses)

    `consecutive_dismissals_by_category` is caller-owned state (e.g. persisted
    per user in the Feedback Service) tracking a running dismissal streak per
    category; passed in explicitly rather than hidden as a global to keep this
    function pure/testable.
    """
    current_rate = ctx.category_acceptance_rate.get(
        event.category, DEFAULT_ACCEPTANCE_PRIORS.get(event.category, 0.35)
    )
    delta = FEEDBACK_DELTA.get(event.event_type, 0.0)
    weighted_delta = delta * _recency_weight(event)
    new_rate = max(0.02, min(0.98, current_rate + weighted_delta))
    ctx.category_acceptance_rate[event.category] = round(new_rate, 4)

    fp = fingerprint(event.user_id, event.category, event.action_type)

    if event.event_type == FeedbackType.DISMISSED:
        ctx.recent_rejected_fingerprints[fp] = event.occurred_at
        consecutive_dismissals_by_category[event.category] = (
            consecutive_dismissals_by_category.get(event.category, 0) + 1
        )
        if consecutive_dismissals_by_category[event.category] >= CONSECUTIVE_DISMISSAL_SUPPRESSION_THRESHOLD:
            # Soft-suppress: category is disabled outright for a cooldown window.
            # (Production Feedback Service would schedule re-enabling after
            # SOFT_SUPPRESSION_DAYS; this reference implementation only sets
            # the flag, since scheduling itself is an infra concern outside
            # this pure-function scope.)
            ctx.disabled_categories.add(event.category)
    elif event.event_type in (FeedbackType.ACCEPTED, FeedbackType.PARTIALLY_COMPLETED,
                               FeedbackType.BEHAVIOUR_CONFIRMED):
        # Any positive signal resets the dismissal streak for this category.
        consecutive_dismissals_by_category[event.category] = 0
    elif event.event_type == FeedbackType.IGNORED:
        # Ignoring is a much weaker negative signal than dismissing (Section 6.1) --
        # it does not by itself extend the dismissal streak or trigger cooldown.
        pass


# ----------------------------------------------------------------------------
# 3. Ranking pipeline (scoring + anti-spam filters)
# ----------------------------------------------------------------------------

def rank_and_filter(
    candidates: list[RecommendationCandidate],
    ctx: UserContext,
    today: date,
    max_per_day: int = 3,
) -> list[RecommendationCandidate]:
    # 1. score everything
    for c in candidates:
        c.score_breakdown = score_candidate(c, ctx, today)

    # 2. drop suppressed (rejected recently), user-disabled categories, and
    # below-threshold. disabled_categories is a HARD exclusion here -- a
    # user who has turned a category off must never see it, regardless of
    # score. (preference_fit() already zeroes that one weighted term for a
    # disabled category too, but a soft scoring penalty alone doesn't
    # guarantee exclusion if other signals -- carbon savings, a strong
    # LinUCB opinion, etc. -- are high enough; this hard filter is what
    # actually enforces "disabled means never shown".)
    surviving = [
        c for c in candidates
        if not is_suppressed(c, ctx)
        and c.category not in ctx.disabled_categories
        and c.score_breakdown.final_score >= MIN_DISPLAY_SCORE
    ]

    # 3. sort by score descending
    surviving.sort(key=lambda c: c.score_breakdown.final_score, reverse=True)

    # 4. category balancing — at most one per category unless too few candidates overall
    selected: list[RecommendationCandidate] = []
    used_categories: set = set()
    for c in surviving:
        if len(selected) >= max_per_day:
            break
        if c.category in used_categories and len(surviving) > max_per_day:
            continue
        selected.append(c)
        used_categories.add(c.category)

    # fill remaining slots from leftovers if category balancing left room unused
    if len(selected) < max_per_day:
        for c in surviving:
            if len(selected) >= max_per_day:
                break
            if c not in selected:
                selected.append(c)

    return selected


# ----------------------------------------------------------------------------
# 4. Explanation trace generation
# ----------------------------------------------------------------------------

def build_explanation(candidate: RecommendationCandidate) -> dict:
    """Structured reasoning trace — see Part 2 §5.1. This is what gets stored;
    human-readable copy is templated from this, never generated independently."""
    sb = candidate.score_breakdown
    trace = {
        "recommendation_id": candidate.id,
        "trigger": {
            "type": candidate.trigger_type.value,
            "pattern_summary": (
                f"{candidate.source_pattern.pattern_type} observed "
                f"{candidate.source_pattern.occurrences}/{candidate.source_pattern.eligible_opportunities} times, "
                f"confidence {candidate.source_pattern.confidence}"
                if candidate.source_pattern else None
            ),
        },
        "carbon_calculation": {
            "baseline_activity": candidate.baseline_activity,
            "baseline_quantity_kg": candidate.baseline_quantity,
            "baseline_factor": f"{candidate.baseline_factor.source} {candidate.baseline_factor.version}",
            "baseline_emissions_kg": candidate.baseline_emissions_kg,
            "recommended_activity": candidate.recommended_activity,
            "recommended_quantity_kg": candidate.recommended_quantity,
            "recommended_factor": f"{candidate.recommended_factor.source} {candidate.recommended_factor.version}",
            "recommended_emissions_kg": candidate.recommended_emissions_kg,
            "saved_kg_co2e": candidate.saved_kg_co2e,
            "percent_reduction": candidate.percent_reduction,
        },
        "score_breakdown": sb.__dict__ if sb else None,
        "engine_version": "rules-v1.4",
    }
    return trace


def render_explanation_text(candidate: RecommendationCandidate) -> str:
    """Template-based human-readable copy — never independently generated,
    always derived from the same fields as the stored trace (Part 2 §5.2)."""
    if candidate.source_pattern and candidate.estimate_confidence >= MIN_CONFIDENCE_FOR_SPECIFIC_CLAIM:
        return (
            f"You've logged {candidate.baseline_activity.replace('_', ' ')} "
            f"{candidate.source_pattern.occurrences} of the last {candidate.source_pattern.eligible_opportunities} "
            f"relevant occasions. Swapping to {candidate.recommended_activity.replace('_', ' ')} today could save "
            f"about {candidate.saved_kg_co2e} kg CO2e ({candidate.percent_reduction}% less)."
        )
    else:
        return (
            f"Swapping to {candidate.recommended_activity.replace('_', ' ')} may save around "
            f"{candidate.saved_kg_co2e} kg CO2e — a good general habit while we learn your patterns."
        )


# ----------------------------------------------------------------------------
# 5. Demo — matches the spec's chicken -> paneer worked example
# ----------------------------------------------------------------------------

def _demo():
    user_id = "user_demo_1"
    now = datetime(2026, 7, 30, 8, 0, 0)  # a Thursday
    today = now.date()

    # ------------------------------------------------------------------
    # Carbon Calculation Service stand-in. In production this is an HTTP
    # call to the existing external service (HttpCarbonCalculationClient);
    # here we register the same factor values as demo/test fixtures so the
    # example is runnable offline. No emissions math happens in this file --
    # the client is the only thing that knows kg-per-unit values.
    # ------------------------------------------------------------------
    carbon_client = InMemoryCarbonCalculationClient()
    carbon_client.register("chicken_curry_cooked", 6.9, "Poore_Nemecek_2021", "v3")
    carbon_client.register("paneer_curry_cooked", 0.9, "Poore_Nemecek_2021", "v3")
    carbon_client.register("lentil_curry_cooked", 0.5, "Poore_Nemecek_2021", "v3")
    carbon_client.register("car_solo_commute", 0.192, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    carbon_client.register("car_carpool_commute", 0.096, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    carbon_client.register("two_wheeler_solo_commute", 0.103, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    carbon_client.register("auto_rickshaw_commute", 0.14, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    carbon_client.register("bus_commute", 0.089, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    carbon_client.register("metro_commute", 0.041, "DEFRA_2024", "v1", unit="kg_co2e_per_km")
    # EV factor varies by region because it depends on the local electricity
    # generation mix (proposal Methodology Section 5) -- registered per-region,
    # with a GLOBAL fallback for regions without a specific factor.
    carbon_client.register("ev_solo_commute", 0.053, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="GLOBAL")
    carbon_client.register("ev_solo_commute", 0.028, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="IN_PUNJAB")  # cleaner grid
    carbon_client.register("ev_solo_commute", 0.071, "IEA_2024", "v1", unit="kg_co2e_per_km", region_code="IN_COAL_HEAVY")  # coal-heavy grid
    carbon_client.register("standby_power_overnight", 0.4, "DEFRA_2024", "v1", unit="kg_co2e_per_kwh")
    carbon_client.register("devices_off_overnight", 0.0, "DEFRA_2024", "v1", unit="kg_co2e_per_kwh")
    carbon_client.register("single_use_plastic_bottle", 0.08, "DEFRA_2024", "v1", unit="kg_co2e_per_item")
    carbon_client.register("reusable_bottle_use", 0.0, "DEFRA_2024", "v1", unit="kg_co2e_per_item")

    # Simulate 5 recent Thursdays, chicken logged on 4 of them
    thursdays = [now - timedelta(weeks=w) for w in range(1, 6)]
    chicken_activities = [
        Activity(user_id, Category.FOOD, "chicken_curry", 0.35, "kg", t)
        for t in thursdays[:4]  # 4 of the last 5 Thursdays
    ]

    pattern = mine_pattern(
        user_id=user_id,
        pattern_type="meal_day_of_week",
        dimensions={"day_of_week": 3, "food_category": "chicken"},  # Thursday = 3
        matching_activities=chicken_activities,
        eligible_opportunities=5,
        as_of=now,
    )
    assert pattern is not None
    print(f"Mined pattern: {pattern.pattern_type} confidence={pattern.confidence} "
          f"({pattern.occurrences}/{pattern.eligible_opportunities})")

    # ------------------------------------------------------------------
    # A second pattern, for transport, logged consistently enough to cross
    # is_mature (>=0.65) -- this is what actually unlocks the requires_mature
    # solo_car_to_ev rule below. To show the gate doing real work (not just
    # exercising the "always on" path), we first mine a WEAKER version of the
    # same behaviour -- fewer, less regular occurrences -- and confirm the EV
    # rule stays locked for that one, before mining the stronger version that
    # unlocks it.
    # ------------------------------------------------------------------
    weekdays_9 = [now - timedelta(days=d) for d in (2, 9, 16, 23, 30, 37, 44, 51, 58)]
    car_activities_early = [
        Activity(user_id, Category.TRANSPORT, "car_solo_commute", 6.0, "km", t)
        for t in weekdays_9[:4]  # 4 of 9 opportunities -- lands in the 0.35-0.65 early band
    ]
    pattern_transport_early = mine_pattern(
        user_id=user_id, pattern_type="transport_weekday",
        dimensions={"day_of_week": now.weekday()},
        matching_activities=car_activities_early, eligible_opportunities=9, as_of=now,
    )
    assert pattern_transport_early is not None and pattern_transport_early.is_early
    candidates_early = generate_candidates(
        user_id=user_id, patterns=[pattern, pattern_transport_early],
        carbon_client=carbon_client, account_age_days=90,
    )
    print(f"\n[requires_mature check] early-tier transport pattern "
          f"(confidence={pattern_transport_early.confidence}, is_mature={pattern_transport_early.is_mature}): "
          f"solo_car_to_ev generated? {'solo_car_to_ev' in [c.action_type for c in candidates_early]}")

    # Now the stronger, consistent version of the same behaviour -- same
    # weekday, 8 of 9 opportunities, evenly spaced -- which should cross 0.65.
    car_activities_mature = [
        Activity(user_id, Category.TRANSPORT, "car_solo_commute", 6.0, "km", t)
        for t in weekdays_9[:8]
    ]
    pattern_transport = mine_pattern(
        user_id=user_id, pattern_type="transport_weekday",
        dimensions={"day_of_week": now.weekday()},
        matching_activities=car_activities_mature, eligible_opportunities=9, as_of=now,
    )
    assert pattern_transport is not None
    print(f"[requires_mature check] mature-tier transport pattern "
          f"(confidence={pattern_transport.confidence}, is_mature={pattern_transport.is_mature})")

    # ------------------------------------------------------------------
    # Candidate generation: mature-tier user (account_age_days=90), two
    # mined patterns -> the rule library produces the food swap candidates,
    # transport candidates (including the now-unlocked EV rule), plus
    # whichever cold-start-safe generic rules always apply.
    # ------------------------------------------------------------------
    candidates = generate_candidates(
        user_id=user_id,
        patterns=[pattern, pattern_transport],
        carbon_client=carbon_client,
        account_age_days=90,
    )
    print(f"\nGenerated {len(candidates)} candidates: {[c.action_type for c in candidates]}")
    print(f"(solo_car_to_ev now generated: {'solo_car_to_ev' in [c.action_type for c in candidates]})")

    # ------------------------------------------------------------------
    # Real per-user carbon baseline (aggregate_user_carbon_baseline), from
    # the same activity history used above -- this replaces what used to be
    # a hardcoded 2.5 constant in score_candidate. Uses the MATURE transport
    # history (8 solo-car commutes) plus the chicken activities, so the
    # transport baseline reflects this user's actual typical commute footprint.
    # ------------------------------------------------------------------
    all_activities = chicken_activities + car_activities_mature
    user_baseline = aggregate_user_carbon_baseline(all_activities, carbon_client, as_of=now)
    print(f"\nUser's own carbon baseline (kg CO2e per active day, per category): {user_baseline}")

    # ------------------------------------------------------------------
    # Friend-group context: two friends, one carpools often, group's
    # transport footprint average is lower than this user's own -- both
    # signals should raise peer_relevance for the carpool candidate.
    # ------------------------------------------------------------------
    peer_group = PeerGroupContext(
        group_id="group_demo_1",
        group_avg_category_kg={Category.TRANSPORT: 1.6, Category.FOOD: 2.0},
        user_avg_category_kg={Category.TRANSPORT: 2.4, Category.FOOD: 2.1},  # user is above group avg on transport
        peer_actions=[
            PeerAction("Krishna", Category.TRANSPORT, "solo_car_to_carpool", frequency_per_week=3.0),
        ],
        group_size=5,
    )

    ctx = UserContext(
        user_id=user_id,
        category_acceptance_rate={Category.FOOD: 0.46},
        category_priority_weight={Category.FOOD: 0.7, Category.TRANSPORT: 0.5},
        disabled_categories=set(),
        dietary_constraints=set(),
        fatigue_level=0.1,
        recent_action_fingerprints={},
        recent_rejected_fingerprints={},
        peer_group=peer_group,
        category_avg_daily_kg=user_baseline,
    )

    selected = rank_and_filter(candidates, ctx, today)
    for c in selected:
        projection = project_savings(c)
        print("\n--- Recommendation Card ---")
        print(f"Title: {c.title}")
        print(f"Description: {c.description}")
        print(f"Impact: Save {c.saved_kg_co2e} kg CO2e ({c.percent_reduction}% lower)")
        print(f"Projected: weekly={projection.weekly_kg}kg monthly={projection.monthly_kg}kg yearly={projection.yearly_kg}kg")
        print(f"Difficulty: {c.difficulty.value}")
        print(f"Confidence: {c.estimate_confidence}")
        print(f"Final score: {c.score_breakdown.final_score} "
              f"(carbon_savings={c.score_breakdown.carbon_savings}, peer_relevance={c.score_breakdown.peer_relevance})")
        print(f"Why: {render_explanation_text(c)}")
        print(f"Tradeoff: {c.tradeoff_note}")

    # ------------------------------------------------------------------
    # Feedback loop: simulate the user accepting the top recommendation,
    # then show it nudges the category's acceptance probability upward.
    # ------------------------------------------------------------------
    if selected:
        top = selected[0]
        print(f"\n--- Feedback ---")
        print(f"Acceptance probability before feedback: {ctx.category_acceptance_rate.get(top.category)}")
        event = FeedbackEvent(
            user_id=user_id, recommendation_id=top.id, category=top.category,
            action_type=top.action_type, event_type=FeedbackType.ACCEPTED, occurred_at=now,
        )
        process_feedback(event, ctx, consecutive_dismissals_by_category={})
        print(f"Acceptance probability after 'accepted' feedback: {ctx.category_acceptance_rate.get(top.category)}")


if __name__ == "__main__":
    _demo()
