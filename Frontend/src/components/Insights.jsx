import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { insightsApi } from "../api";
import AppShell from "./AppShell";

export default function Insights() {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const res = await insightsApi.get();
      setInsights(res.insights || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <AppShell wide>
      <div className="page-head">
        <div>
          <p className="page-eyebrow">Personalized</p>
          <h1 className="page-title">AI Insights</h1>
          <p className="page-sub">
            Recommendations computed from your own logged data — every figure below is
            reproducible from the same emission factor table your calculator uses.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn--ghost" onClick={load}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="boot-state"><div className="boot-ring" /><p>Analyzing your activity…</p></div>
      ) : insights.length === 0 ? (
        <div className="empty-state">
          <h3>No insights yet</h3>
          <p>Log some activity in the Carbon Calculator and check back.</p>
          <Link to="/calculator" className="btn btn--primary">Open Calculator</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {insights.map((ins, i) => (
            <article key={i} className="insight-card" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="insight-icon">{ins.icon}</div>
              <div style={{ flex: 1 }}>
                <h3 className="insight-title">{ins.title}</h3>
                <p className="insight-body">{ins.body}</p>
                {ins.stat && <p className="insight-stat" style={{ marginTop: 8 }}>{ins.stat}</p>}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="section-label"><span>How This Works</span></div>
      <div className="panel">
        <p style={{ color: "var(--text-2)", fontSize: "0.86rem", lineHeight: 1.7, margin: 0 }}>
          This engine is rule-based, not a generated response from a language model. It reads your
          last 30 days of carbon activity and time-bank transactions, compares them against the
          same GHG-Protocol emission factor table the Carbon Calculator uses, and surfaces the
          patterns with the largest potential impact — dominant emission domain, transport mode
          switches, under-used carbon-linked service categories, and logging consistency. Every
          number shown is computed directly from your data, not estimated by a model.
        </p>
      </div>
    </AppShell>
  );
}
