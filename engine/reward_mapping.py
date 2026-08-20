"""
Feedback -> LinUCB Reward Mapping
====================================

Turns a FeedbackEvent's event_type into the bounded numeric reward
LinUCB.update() expects (see linucb.py's module docstring -- LinUCB's
standard theory assumes a bounded reward; this mapping targets [-1, 1]
rather than [0, 1], because some feedback types (DISMISSED) represent an
unambiguous negative outcome the model should actively steer away from, not
merely "less positive than accepted").

Deliberately reuses recommendation_engine.py's existing FEEDBACK_DELTA table
(the tuning already used to nudge UserContext.category_acceptance_rate, per
`02-recommendation-algorithm.md` Section 6.2) rather than inventing a second,
independent judgment call about which feedback type matters how much more
than another. This module only RESCALES that same relative ordering into the
wider dynamic range a per-round bandit reward needs -- FEEDBACK_DELTA's own
deltas are small (+-0.03 to +-0.12), tuned for a slow-moving EMA-like
probability nudge, not a per-round reward signal that needs to actually
separate a good arm's predicted mean from a bad one's within a realistic
number of feedback rounds.

FEEDBACK_DELTA and this module's reward mapping are two INDEPENDENT
consumers of the same FeedbackEvent stream. process_feedback() (the existing
acceptance-probability/cooldown/suppression mechanism in
recommendation_engine.py) is untouched by this module and keeps running
exactly as before -- this is an additive second consumer, not a
replacement. `orchestrator.py`'s `InMemoryUserStore.record_feedback()` is
what actually calls `reward_for_feedback_event()` and feeds the result into
a live `LinUCB.update()` call, alongside (not instead of) `process_feedback()`.
"""

from __future__ import annotations

from recommendation_engine import FeedbackEvent, FeedbackType, FEEDBACK_DELTA

# Rescale FEEDBACK_DELTA's existing relative valence onto [-1, 1] by dividing
# through by its largest-magnitude entry -- preserves the exact ordering and
# proportions FEEDBACK_DELTA already encodes (BEHAVIOUR_CONFIRMED strongest
# positive, DISMISSED strongest negative, IGNORED a much weaker negative than
# DISMISSED, etc.), just stretched onto a full bandit-reward range instead of
# a small EMA nudge.
_MAX_ABS_DELTA = max(abs(v) for v in FEEDBACK_DELTA.values())

REWARD_FOR_EVENT_TYPE: dict[FeedbackType, float] = {
    event_type: round(delta / _MAX_ABS_DELTA, 4)
    for event_type, delta in FEEDBACK_DELTA.items()
}


def reward_for_event_type(event_type: FeedbackType) -> float:
    """The bounded [-1, 1] LinUCB reward for one FeedbackType value."""
    return REWARD_FOR_EVENT_TYPE[event_type]


def reward_for_feedback_event(event: FeedbackEvent) -> float:
    """The bounded [-1, 1] LinUCB reward for one observed FeedbackEvent.

    Reward depends only on event.event_type -- carbon-savings magnitude,
    category, and recency are deliberately NOT folded in here. Those already
    influence which candidates get generated/ranked upstream (dynamic
    candidate generation, score_candidate); conflating "the user liked this
    recommendation" with "this recommendation happened to represent a big
    carbon swap" would make the reward signal ambiguous about what LinUCB is
    actually learning to predict. This mapping answers exactly one question:
    given this feedback event happened, was it a good or bad outcome for the
    arm that was shown?
    """
    return reward_for_event_type(event.event_type)


# ----------------------------------------------------------------------------
# Empirically calibrated alpha
# ----------------------------------------------------------------------------
#
# linucb_features.build_context_vector() produces vectors with a typical L2
# norm in the ~2.5-3.5 range (measured across real candidates generated from
# the 104-entry knowledge base -- most of the 22 features sit in [0,1] with
# several pinned at exactly 0 or 1 from the one-hot blocks). LinUCB's
# fresh-arm exploration bonus is alpha * ||x||; with this module's [-1, 1]
# reward range, a repeatedly-rewarded arm's predicted_mean can climb at most
# to the reward it keeps receiving (1.0, for BEHAVIOUR_CONFIRMED).
#
# A generic alpha=1.0 default (reasonable for linucb.py as a standalone
# primitive, which knows nothing about this specific feature space) gives a
# fresh-arm bonus of roughly alpha * 3.0 = 3.0 -- well above the achievable
# 1.0 reward ceiling, so an unexplored arm would permanently outscore even a
# maximally-rewarded, well-evidenced one (see this project's Task 3 finding).
#
# RECOMMENDED_ALPHA=0.2 gives a fresh-arm bonus of roughly alpha * 2.786 =
# 0.557 -- the same order of magnitude as this module's reward range, not
# several times larger. Verified empirically in test_reward_mapping.py
# against real pipeline-generated context vectors (54 real candidates from
# a seeded demo user) and this module's actual REWARD_FOR_EVENT_TYPE values
# (not synthetic +-1.0 rewards): with RECOMMENDED_ALPHA, a single ACCEPTED
# event is already enough to move an arm to the top of the ranking (ahead of
# every untouched arm) and a single DISMISSED event is enough to move it to
# the very bottom, and both positions hold stably under further repeated
# feedback of the same kind -- so real signal reliably wins over unexplored
# arms without needing an unrealistically long run-in period, while
# untouched arms are provably undisturbed in between (the "disjoint"
# property from linucb.py's own test suite). This is a reasonable,
# empirically sanity-checked starting point, not a rigorously globally
# optimal value -- like any bandit hyperparameter, it should be revisited
# once real usage/feedback data exists.
RECOMMENDED_ALPHA = 0.2
