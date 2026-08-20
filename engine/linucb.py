"""
LinUCB -- Disjoint Contextual Bandit
=======================================

A real implementation of disjoint LinUCB (Li, Chu, Langford, Schapire 2010,
"A Contextual-Bandit Approach to Personalized News Article Recommendation"),
the standard form: one independent ridge-regression model (A_a, b_a) per arm,
scored per round as predicted-mean + an upper-confidence-bound exploration
term over whatever arms happen to be available that round.

This module is deliberately domain-agnostic -- it knows nothing about
recommendations, categories, or users. An "arm" is just a hashable id
(str); a "context" is just a fixed-length numeric vector. That decoupling is
intentional: `linucb_features.py` builds the recommendation-domain context
vectors, this module does the bandit math on whatever vectors it's handed,
and `orchestrator.py` (ranking wiring) + `reward_mapping.py` (feedback ->
reward) connect the two to the live pipeline. Keeping this file free of
recommendation_engine/knowledge_base/etc. imports means it was tested, and
trusted, entirely on its own before anything downstream depended on it.

Math (per arm a, context x in R^d):
    A_a  <- d x d matrix, initialised to ridge_lambda * I_d
    b_a  <- d-vector, initialised to 0

    theta_a = A_a^-1 b_a                        (ridge-regression estimate)
    predicted_mean(a, x)  = theta_a . x
    uncertainty(a, x)     = alpha * sqrt(x^T A_a^-1 x)
    ucb_score(a, x)       = predicted_mean(a, x) + uncertainty(a, x)

    update(a, x, r):
        A_a <- A_a + x x^T
        b_a <- b_a + r * x

`alpha` controls the exploration/exploitation trade-off: alpha=0 is pure
greedy exploitation on the current ridge-regression estimate; larger alpha
widens the confidence bound, favouring arms with less accumulated evidence
(new/rarely-shown recommendations) until their own data narrows it back down.
`ridge_lambda` is the ridge-regression prior strength (A_a's initial scale);
larger ridge_lambda means more initial regularisation pulling predictions
toward 0 and a tighter initial confidence bound.

State (A_a, b_a per arm) is meant to persist across recommendation rounds --
see to_state()/from_state() for a JSON-serialisable snapshot. This module
does not itself read or write a file/database; that's an integration
decision for whatever wires this model into the live pipeline.
"""

from __future__ import annotations

import numpy as np


class LinUCB:
    """Disjoint (per-arm) LinUCB contextual bandit.

    One independent (A_a, b_a) ridge-regression state per arm_id, lazily
    created on first use (score_arm/update) with A_a = ridge_lambda * I_d,
    b_a = 0 -- an untouched arm therefore has predicted_mean == 0 and its
    ucb_score is exploration-only, so brand-new arms aren't starved relative
    to arms with accumulated history.
    """

    def __init__(self, n_features: int, alpha: float = 1.0, ridge_lambda: float = 1.0):
        if n_features <= 0:
            raise ValueError(f"n_features must be positive, got {n_features}")
        self.n_features = n_features
        self.alpha = alpha
        self.ridge_lambda = ridge_lambda
        self._A: dict[str, np.ndarray] = {}
        self._b: dict[str, np.ndarray] = {}

    # ------------------------------------------------------------------
    # Arm state
    # ------------------------------------------------------------------

    def _ensure_arm(self, arm_id: str) -> None:
        if arm_id not in self._A:
            self._A[arm_id] = self.ridge_lambda * np.eye(self.n_features)
            self._b[arm_id] = np.zeros(self.n_features)

    def _as_vector(self, context_vector) -> np.ndarray:
        x = np.asarray(context_vector, dtype=float)
        if x.shape != (self.n_features,):
            raise ValueError(
                f"context_vector has shape {x.shape}, expected ({self.n_features},)"
            )
        return x

    def known_arms(self) -> list[str]:
        """Arm ids this model has ever seen a context vector for (via
        score_arm or update) -- an arm's presence here does not imply any
        reward has been observed for it yet, only that ridge state exists."""
        return list(self._A.keys())

    def reset_arm(self, arm_id: str) -> None:
        """Discard an arm's accumulated state, if any -- it will be
        re-initialised fresh on next use. No-op if the arm was never seen."""
        self._A.pop(arm_id, None)
        self._b.pop(arm_id, None)

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    def predict_mean(self, arm_id: str, context_vector) -> float:
        """theta_a . x -- the ridge-regression point estimate alone, with no
        exploration bonus. Exposed separately from score_arm() so callers
        (and tests) can inspect exploitation vs. exploration independently."""
        self._ensure_arm(arm_id)
        x = self._as_vector(context_vector)
        A_inv = np.linalg.inv(self._A[arm_id])
        theta = A_inv @ self._b[arm_id]
        return float(theta @ x)

    def uncertainty(self, arm_id: str, context_vector) -> float:
        """alpha * sqrt(x^T A_a^-1 x) -- the exploration bonus alone."""
        self._ensure_arm(arm_id)
        x = self._as_vector(context_vector)
        A_inv = np.linalg.inv(self._A[arm_id])
        return float(self.alpha * np.sqrt(max(0.0, x @ A_inv @ x)))

    def score_arm(self, arm_id: str, context_vector) -> float:
        """Full UCB score: predict_mean + uncertainty. This is what
        select_arm()/rank_arms() rank by."""
        return self.predict_mean(arm_id, context_vector) + self.uncertainty(arm_id, context_vector)

    def rank_arms(self, context_vectors: dict[str, list]) -> list[tuple[str, float]]:
        """Score every arm in `context_vectors` (arm_id -> context vector)
        and return (arm_id, score) pairs sorted by score, highest first.
        Only arms present in `context_vectors` are considered -- this is how
        a per-round "available arms" set (e.g. this week's dynamically
        generated candidate pool) restricts selection without touching this
        model's persisted per-arm state for arms not currently eligible."""
        if not context_vectors:
            raise ValueError("rank_arms() requires at least one candidate arm")
        scored = [(arm_id, self.score_arm(arm_id, vec)) for arm_id, vec in context_vectors.items()]
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored

    def select_arm(self, context_vectors: dict[str, list]) -> str:
        """Return the single highest-scoring arm_id from `context_vectors`."""
        return self.rank_arms(context_vectors)[0][0]

    # ------------------------------------------------------------------
    # Learning
    # ------------------------------------------------------------------

    def update(self, arm_id: str, context_vector, reward: float) -> None:
        """Incorporate one observed (context, reward) outcome for `arm_id`:
            A_a <- A_a + x x^T
            b_a <- b_a + r * x

        `reward` is not clamped or validated here -- mapping a real user
        feedback event (accepted/dismissed/ignored/...) into a numeric
        reward is a separate concern (kept out of this domain-agnostic
        module deliberately); LinUCB's standard theory assumes a bounded
        reward (commonly [0, 1]), so callers should keep to that range
        unless they have a specific reason not to.
        """
        self._ensure_arm(arm_id)
        x = self._as_vector(context_vector)
        self._A[arm_id] = self._A[arm_id] + np.outer(x, x)
        self._b[arm_id] = self._b[arm_id] + reward * x

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def to_state(self) -> dict:
        """JSON-serialisable snapshot of every arm's (A_a, b_a) plus the
        hyperparameters needed to reconstruct an identical model via
        from_state(). Does not write to disk itself -- callers decide the
        storage medium (file, database row, etc.)."""
        return {
            "n_features": self.n_features,
            "alpha": self.alpha,
            "ridge_lambda": self.ridge_lambda,
            "arms": {
                arm_id: {
                    "A": self._A[arm_id].tolist(),
                    "b": self._b[arm_id].tolist(),
                }
                for arm_id in self._A
            },
        }

    @classmethod
    def from_state(cls, state: dict) -> "LinUCB":
        """Reconstruct a LinUCB model from a to_state() snapshot, with every
        arm's accumulated (A_a, b_a) restored exactly."""
        model = cls(
            n_features=state["n_features"],
            alpha=state["alpha"],
            ridge_lambda=state["ridge_lambda"],
        )
        for arm_id, arm_state in state.get("arms", {}).items():
            model._A[arm_id] = np.array(arm_state["A"], dtype=float)
            model._b[arm_id] = np.array(arm_state["b"], dtype=float)
        return model
