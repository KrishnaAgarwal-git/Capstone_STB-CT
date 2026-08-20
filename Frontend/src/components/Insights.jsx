import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { insightsApi } from "../api";
import AppShell from "./AppShell";
import { spotlightMove } from "../utils/spotlight";
import { SkeletonList } from "./Skeleton";

const TIER_LABEL = {
  cold: "Cold start — not enough data yet",
  developing: "Developing — building a picture of your habits",
  established: "Established — high-confidence personalization",
};

export default function Insights() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tracks in-flight/just-completed feedback per recommendationId, so a
  // button shows an immediate confirmed state before the list reloads -
  // { [id]: 'sending' | 'accepted' | 'dismissed' }
  const [feedbackState, setFeedbackState] = useState({});

  const load = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await insightsApi.get();
      setResult(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const insights = result?.insights || [];
  const isEngine = result?.source === "linucb_engine";
  const isFallback = result?.source === "rule_based_fallback";

  const submitFeedback = async (recommendationId, eventType, uiLabel) => {
    if (!recommendationId || feedbackState[recommendationId]) return;
    setFeedbackState((s) => ({ ...s, [recommendationId]: "sending" }));
    try {
      await insightsApi.feedback(recommendationId, eventType);
      setFeedbackState((s) => ({ ...s, [recommendationId]: eventType }));
      toast.success(
        `${uiLabel} — the engine will factor this into what it shows you next.`
      );
      // Reload shortly after, so the list visibly updates - this is the
      // moment that actually demonstrates the engine learned something,
      // not just that a click was registered.
      setTimeout(() => load(true), 900);
    } catch (err) {
      setFeedbackState((s) => {
        const next = { ...s };
        delete next[recommendationId];
        return next;
      });
      toast.error(err.message);
      if (err.status === 404) {
        // Stale/expired recommendation id (e.g. engine restarted) - the
        // honest response is to refresh, not pretend it worked.
        load();
      }
    }
  };

  return (
    <AppShell wide>
      <div className="page-head">
        <div>
          <p className="page-eyebrow">Personalized</p>
          <h1 className="page-title">AI Insights</h1>
          <p className="page-sub">
            {isEngine
              ? "Live recommendations from the LinUCB contextual-bandit recommendation engine, learning from your real activity."
              : "Recommendations computed from your own logged data."}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn--ghost" onClick={() => load()}>Refresh</button>
        </div>
      </div>

      {!loading && isFallback && (
        <div className="panel engine-status-banner">
          <p>
            The AI recommendation engine is currently offline — showing rule-based
            recommendations instead. Start <code>engine/engine_server.py</code> to enable
            the full LinUCB-based engine, including learning from your accept/dismiss feedback.
          </p>
        </div>
      )}

      {!loading && isEngine && result?.profile && (
        <div className="panel spotlight" onMouseMove={spotlightMove}>
          <div className="engine-profile-stats">
            <div>
              <p className="field-hint engine-profile-stat-label">Personalization tier</p>
              <p className="engine-profile-stat-value">
                {TIER_LABEL[result.profile.confidenceTier] || result.profile.confidenceTier}
              </p>
            </div>
            <div>
              <p className="field-hint engine-profile-stat-label">Data confidence</p>
              <p className="engine-profile-stat-value">
                {Math.round((result.profile.overallConfidence || 0) * 100)}%
              </p>
            </div>
            <div>
              <p className="field-hint engine-profile-stat-label">Active days (30d)</p>
              <p className="engine-profile-stat-value">{result.profile.activeDays}</p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonList count={3} />
      ) : insights.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✨</div>
          <h3>No insights yet</h3>
          <p>Log some activity in the Carbon Calculator and check back.</p>
          <Link to="/calculator" className="btn btn--primary">Open Calculator</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {insights.map((ins, i) => {
            const fb = feedbackState[ins.recommendationId];
            const isDecided = fb === "accepted" || fb === "dismissed";
            return (
              <article
                key={ins.recommendationId || i}
                className={`insight-card spotlight${isDecided ? " insight-card--decided" : ""}`}
                style={{ animationDelay: `${i * 0.08}s` }}
                onMouseMove={spotlightMove}
              >
                <div className="insight-icon">{ins.icon}</div>
                <div style={{ flex: 1 }}>
                  <h3 className="insight-title">{ins.title}</h3>
                  <p className="insight-body">{ins.body}</p>

                  <div className="insight-meta-row">
                    {ins.stat && <span className="insight-stat">{ins.stat}</span>}
                    {typeof ins.percentReduction === "number" && ins.percentReduction > 0 && (
                      <span className="chip chip--green">−{ins.percentReduction}%</span>
                    )}
                    {ins.difficulty && <span className="chip chip--cyan">{ins.difficulty}</span>}
                    {typeof ins.confidence === "number" && (
                      <span className="chip">confidence {Math.round(ins.confidence * 100)}%</span>
                    )}
                  </div>

                  {(ins.weeklyKgProjection || ins.monthlyKgProjection) && (
                    <div className="insight-projection-row">
                      {typeof ins.weeklyKgProjection === "number" && (
                        <span>~{ins.weeklyKgProjection} kg CO2e / week</span>
                      )}
                      {typeof ins.monthlyKgProjection === "number" && (
                        <span>~{ins.monthlyKgProjection} kg CO2e / month</span>
                      )}
                    </div>
                  )}

                  {ins.tradeoffNote && (
                    <p className="insight-tradeoff">⚠️ {ins.tradeoffNote}</p>
                  )}

                  {ins.recommendationId && (
                    <div className="insight-feedback-row">
                      {fb === "accepted" ? (
                        <span className="chip chip--green">✓ Marked as accepted</span>
                      ) : fb === "dismissed" ? (
                        <span className="chip">Dismissed</span>
                      ) : (
                        <>
                          <button
                            className="btn btn--primary btn--sm"
                            disabled={fb === "sending"}
                            onClick={() => submitFeedback(ins.recommendationId, "accepted", "Accepted")}
                          >
                            {fb === "sending" ? "…" : "✓ I'll try this"}
                          </button>
                          <button
                            className="btn btn--ghost btn--sm"
                            disabled={fb === "sending"}
                            onClick={() => submitFeedback(ins.recommendationId, "dismissed", "Dismissed")}
                          >
                            Not for me
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="section-label"><span>How This Works</span></div>
      <div className="panel">
        <p style={{ color: "var(--text-2)", fontSize: "0.86rem", lineHeight: 1.7, margin: 0 }}>
          {isEngine ? (
            <>
              These recommendations come from a real contextual bandit (LinUCB), blended with a
              hand-tuned rules engine over a 104-entry curated knowledge base. It mines patterns
              from your actual logged activity, scores candidate recommendations against your data
              confidence tier, and prices every option using the same scientific emission factor
              table (DEFRA, CEA India, Poore & Nemecek 2018) as the Carbon Calculator — see
              SCIENTIFIC_BASIS.md. Clicking "I'll try this" or "Not for me" above genuinely feeds
              back into the model — it updates a shared LinUCB weight and your personal profile in
              the engine's memory, and the very next refresh reflects it.
            </>
          ) : (
            <>
              This fallback engine is rule-based, not a generated response from a language model.
              It reads your last 30 days of carbon activity and time-bank transactions and surfaces
              the patterns with the largest potential impact using the same cited emission factor
              data as the Carbon Calculator. Every number shown is computed directly from your
              data, not estimated by a model.
            </>
          )}
        </p>
      </div>
    </AppShell>
  );
}
