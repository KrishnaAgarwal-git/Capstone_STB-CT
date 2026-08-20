"""
Diagnostic Harness: Dynamic (new) Pipeline vs Legacy Cold-Start Pipeline
==========================================================================

Non-destructive, read-only comparison script. Runs the NEW pipeline
(profile_confidence + dynamic_candidate_generator + the real 104-entry
knowledge_base corpus) side-by-side against the OLD/legacy pipeline's
cold-start logic (recommendation_engine._rules_for_tier), for a handful of
realistic seeded demo profiles, and prints where the two pipelines agree or
disagree.

This script is diagnostic-only:
  - It does NOT modify orchestrator.py, recommendation_engine.py,
    knowledge_base.py, profile_confidence.py, dynamic_candidate_generator.py,
    or recommendations_data.py.
  - It does NOT wire generate_dynamic_candidates() into get_recommendations()
    or any live code path.
  - It does NOT call any carbon client or invent carbon numbers -- both
    pipelines are compared strictly at the candidate/rule-selection stage,
    before any carbon estimate is attached.
  - account_age_days is only ever used (a) to seed demo data via
    orchestrator.seed_demo_activities(), and (b) to compute the LEGACY
    cold-start flag for comparison. The new-pipeline path (profile_confidence,
    dynamic_candidate_generator) never reads account_age_days -- this is
    enforced by simply never passing it into that path.

Run directly:
    python diagnostics_dynamic_vs_legacy.py
"""

from __future__ import annotations

from datetime import datetime

import knowledge_base
import orchestrator
import profile_confidence
import recommendation_engine
from dynamic_candidate_generator import generate_dynamic_candidates
from recommendation_engine import Activity


# ----------------------------------------------------------------------------
# Profile definitions
# ----------------------------------------------------------------------------
# (name, account_age_days_for_seeding, truncate_to_n_activities_or_None)
PROFILES: list[tuple[str, int, "int | None"]] = [
    ("cold_new", 3, None),
    ("cold_sparse_old", 40, 4),
    ("developing", 15, None),
    ("established_dense", 35, None),
    ("established_sparse", 35, 6),
]


def build_activities(user_id: str, account_age_days: int, truncate_to: "int | None") -> list[Activity]:
    """Seed demo activities via the existing orchestrator helper, optionally
    truncated to the first N activities to simulate a sparse account."""
    activities = orchestrator.seed_demo_activities(user_id, account_age_days, rng_seed=42)
    if truncate_to is not None:
        activities = activities[:truncate_to]
    return activities


# ----------------------------------------------------------------------------
# Report helpers
# ----------------------------------------------------------------------------

def _count_by_category(items, category_getter) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        cat = category_getter(item)
        key = cat.value if hasattr(cat, "value") else str(cat)
        counts[key] = counts.get(key, 0) + 1
    return counts


def run_profile(name: str, account_age_days: int, truncate_to: "int | None") -> dict:
    """Run both pipelines for one profile and return a result dict used both
    for printing and for the test suite to assert against."""
    user_id = f"diag_{name}"
    activities = build_activities(user_id, account_age_days, truncate_to)
    as_of = datetime.now()

    # --- shared mining step (both pipelines consume the same patterns) ---
    patterns = orchestrator.mine_patterns_from_activities(activities, as_of=as_of)
    pattern_types_present = {p.pattern_type for p in patterns}

    # --- NEW pipeline: profile_confidence + dynamic_candidate_generator ---
    # Never reads account_age_days.
    profile = profile_confidence.compute_data_confidence(user_id, activities, as_of)
    new_candidates = generate_dynamic_candidates(
        user_id, knowledge_base.all_recommendations(), patterns, profile,
        max_per_category=8,
    )

    # --- LEGACY pipeline: recommendation_engine's existing cold-start gate ---
    # account_age_days used here ONLY, clearly labeled LEGACY.
    legacy_is_cold_start = account_age_days < 7 or len(patterns) == 0
    legacy_rules = recommendation_engine._rules_for_tier(
        legacy_is_cold_start, pattern_types_present,
    )

    tier_mismatch = (profile.confidence_tier == "cold") != legacy_is_cold_start

    new_by_category = _count_by_category(new_candidates, lambda c: c.category)
    legacy_by_category = _count_by_category(legacy_rules, lambda r: r.category)

    new_only_categories = sorted(set(new_by_category) - set(legacy_by_category))
    legacy_only_categories = sorted(set(legacy_by_category) - set(new_by_category))

    return {
        "name": name,
        "account_age_days": account_age_days,
        "truncate_to": truncate_to,
        "activities_count": len(activities),
        "patterns": patterns,
        "profile": profile,
        "new_candidates": new_candidates,
        "legacy_rules": legacy_rules,
        "legacy_is_cold_start": legacy_is_cold_start,
        "tier_mismatch": tier_mismatch,
        "new_by_category": new_by_category,
        "legacy_by_category": legacy_by_category,
        "new_only_categories": new_only_categories,
        "legacy_only_categories": legacy_only_categories,
    }


def print_report(result: dict) -> None:
    name = result["name"]
    profile = result["profile"]

    print("=" * 78)
    print(f"PROFILE: {name}  (seeded account_age_days={result['account_age_days']}, "
          f"truncate_to={result['truncate_to']}, activities={result['activities_count']})")
    print("=" * 78)

    print(f"  confidence_tier      : {profile.confidence_tier}")
    print(f"  overall_confidence   : {profile.overall_confidence}")
    print(f"  total_records        : {profile.total_records}")
    print(f"  active_days          : {profile.active_days}")
    print(f"  categories_covered   : {profile.categories_covered}")
    print(f"  recency_days         : {profile.recency_days}")

    print(f"  LEGACY is_cold_start : {result['legacy_is_cold_start']}")
    if result["tier_mismatch"]:
        print("  *** TIER MISMATCH ***  "
              f"(new confidence_tier=='cold' is {profile.confidence_tier == 'cold'}, "
              f"legacy_is_cold_start is {result['legacy_is_cold_start']})")

    print(f"\n  NEW pipeline candidates: {len(result['new_candidates'])} total")
    for cat, count in sorted(result["new_by_category"].items()):
        print(f"    - {cat}: {count}")

    print(f"\n  LEGACY pipeline rules: {len(result['legacy_rules'])} total")
    for cat, count in sorted(result["legacy_by_category"].items()):
        print(f"    - {cat}: {count}")

    if result["new_only_categories"]:
        print(f"\n  Categories in NEW with zero matching LEGACY rules: {result['new_only_categories']}")
    else:
        print("\n  Categories in NEW with zero matching LEGACY rules: (none)")

    if result["legacy_only_categories"]:
        print(f"  Categories in LEGACY with zero matching NEW candidates: {result['legacy_only_categories']}")
    else:
        print("  Categories in LEGACY with zero matching NEW candidates: (none)")

    if name == "established_sparse":
        is_established = profile.confidence_tier == "established"
        print(f"\n  [established_sparse check] confidence_tier == 'established' ? {is_established}")
        if is_established:
            print("  *** FINDING: established_sparse unexpectedly reached 'established' tier ***")
        else:
            print("  OK: established_sparse did NOT reach 'established' tier, as expected.")

    print()


def main() -> None:
    results = []
    for name, account_age_days, truncate_to in PROFILES:
        result = run_profile(name, account_age_days, truncate_to)
        results.append(result)
        print_report(result)

    mismatches = [r["name"] for r in results if r["tier_mismatch"]]
    print("=" * 78)
    print("SUMMARY")
    print("=" * 78)
    if mismatches:
        print(f"TIER MISMATCHES found in profiles: {mismatches}")
    else:
        print("No TIER MISMATCHES found across profiles.")


if __name__ == "__main__":
    main()
