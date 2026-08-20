"""
Structured Recommendation Knowledge Base — Schema & Validation
================================================================

Static, data-driven representation of curated carbon-footprint reduction
recommendations.  This module defines the data model and validation logic;
the actual recommendation corpus lives in `recommendations_data.py`.

Design principles
-----------------
* Frozen dataclass — immutable once loaded, hashable, safe to share.
* No carbon math — only activity keys, text, and metadata.  kg CO2e values
  always come from the external CarbonCalculationClient, never from here.
* One-way dependency — this module never imports or modifies
  recommendation_engine.py, orchestrator.py, or demo_server.py; those files
  import from here, never the reverse.

Live in the recommendation pipeline: `orchestrator.py` calls
`all_recommendations()` on every recommendation round and passes the result
to `dynamic_candidate_generator.generate_dynamic_candidates()` — this is the
actual live candidate corpus, not just a reference/demo data model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from recommendation_engine import Category, Difficulty


# ----------------------------------------------------------------------------
# Data model
# ----------------------------------------------------------------------------

@dataclass(frozen=True)
class RecommendationDefinition:
    """One curated recommendation in the knowledge base.

    Fields mirror theSwapRule shape used by the live pipeline but add
    structured metadata (tags, impact bands, conditions, source notes) that
    a dynamic candidate generator or LinUCB ranker will need later.
    """
    id: str
    category: Category
    title: str
    description_template: str
    action_type: str
    baseline_activity_key: str
    recommended_activity_key: str
    default_quantity: float
    unit: str
    difficulty: Difficulty
    tags: tuple[str, ...]
    applicable_pattern_types: tuple[str, ...]
    cold_start_eligible: bool
    requires_mature: bool
    estimated_impact_band: str
    conditions: dict
    source_note: str


# ----------------------------------------------------------------------------
# Registry
# ----------------------------------------------------------------------------

def all_recommendations() -> list[RecommendationDefinition]:
    """Return the full curated recommendation corpus."""
    from recommendations_data import RECOMMENDATIONS

    return list(RECOMMENDATIONS)


# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------

_VALID_IMPACT_BANDS = {"low", "medium", "high"}

# Any brace-balanced placeholder like {count}, {alternative}, {baseline}
_PLACEHOLDER_RE = re.compile(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}")
# Detect malformed placeholders: opening { without a matching closing }
_MALFORMED_PLACEHOLDER_RE = re.compile(r"\{[^{}]*$|\{[^{}]*\{[^{}]*\}")


def _validate_placeholders(text: str) -> list[str]:
    """Return human-readable problems for malformed {placeholder} tokens."""
    problems: list[str] = []
    # Look for unclosed braces
    if _MALFORMED_PLACEHOLDER_RE.search(text):
        problems.append(f"malformed placeholder brace in: {text[:60]}...")
    # A simpler check: any '{' without a matching '}'
    if "{" in text:
        open_count = text.count("{")
        close_count = text.count("}")
        if open_count != close_count:
            problems.append(
                f"mismatched braces ({open_count} open, {close_count} close) in: {text[:60]}..."
            )
    return problems


def validate_knowledge_base(items: list[RecommendationDefinition]) -> list[str]:
    """Return a list of human-readable validation problems.

    Checks performed:
      - duplicate ids
      - empty title or description_template
      - category not a Category enum member
      - difficulty not a Difficulty enum member
      - malformed {placeholder} tokens in description_template
      - estimated_impact_band not in {low, medium, high}
      - negative default_quantity
      - empty unit
      - empty action_type
      - empty baseline_activity_key or recommended_activity_key
    """
    problems: list[str] = []
    seen_ids: set[str] = set()

    for item in items:
        # Duplicate id
        if item.id in seen_ids:
            problems.append(f"duplicate id: {item.id}")
        seen_ids.add(item.id)

        # Empty critical strings
        if not item.title or not item.title.strip():
            problems.append(f"{item.id}: empty title")
        if not item.description_template or not item.description_template.strip():
            problems.append(f"{item.id}: empty description_template")
        if not item.action_type or not item.action_type.strip():
            problems.append(f"{item.id}: empty action_type")
        if not item.unit or not item.unit.strip():
            problems.append(f"{item.id}: empty unit")
        if not item.baseline_activity_key or not item.baseline_activity_key.strip():
            problems.append(f"{item.id}: empty baseline_activity_key")
        if not item.recommended_activity_key or not item.recommended_activity_key.strip():
            problems.append(f"{item.id}: empty recommended_activity_key")

        # Enum membership
        if not isinstance(item.category, Category):
            problems.append(
                f"{item.id}: category '{item.category}' is not a Category enum member"
            )
        if not isinstance(item.difficulty, Difficulty):
            problems.append(
                f"{item.id}: difficulty '{item.difficulty}' is not a Difficulty enum member"
            )

        # Placeholder syntax in description_template
        problems.extend(
            f"{item.id}: {p}" for p in _validate_placeholders(item.description_template)
        )

        # Impact band
        if item.estimated_impact_band not in _VALID_IMPACT_BANDS:
            problems.append(
                f"{item.id}: estimated_impact_band '{item.estimated_impact_band}' not in {_VALID_IMPACT_BANDS}"
            )

        # Quantity must be non-negative
        if item.default_quantity < 0:
            problems.append(f"{item.id}: default_quantity ({item.default_quantity}) is negative")

    return problems
