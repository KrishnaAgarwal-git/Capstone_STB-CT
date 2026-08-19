import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { carbonApi } from "../api";
import { useAuth } from "../context/AuthContext";
import AppShell from "./AppShell";
import SplineAreaChart from "./SplineAreaChart";

const cardThemes = [
  { ca: "#22d3ee", caLt: "#67e8f9", rgb: "6,182,212" },
  { ca: "#22c55e", caLt: "#4ade80", rgb: "34,197,94" },
  { ca: "#a3e635", caLt: "#d9f99d", rgb: "132,204,22" },
  { ca: "#fbbf24", caLt: "#fde68a", rgb: "251,191,36" },
];

const DOMAIN_LABEL = {
  transportation: "Transport",
  electricity: "Electricity",
  food: "Food",
  consumption: "Consumption",
};

/** Simple trend: compare the last value in a series against the one before it. */
const trendFor = (series) => {
  if (!series || series.length < 2) return { dir: "up", text: "—" };
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = last - prev;
  if (delta === 0) return { dir: "up", text: "→ 0" };
  return delta > 0
    ? { dir: "up", text: `↑ +${Math.abs(delta).toFixed(1)}` }
    : { dir: "down", text: `↓ -${Math.abs(delta).toFixed(1)}` };
};

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCard, setActiveCard] = useState(1);
  const numberRefs = useRef([]);

  const load = async () => {
    try {
      setLoading(true);
      const summary = await carbonApi.summary();
      setData(summary);
      setError(null);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = useMemo(() => {
    if (!data) return [];
    return [
      {
        icon: "⏳",
        label: "Time Credits",
        value: data.credits,
        unit: "cr",
        sub: `Worth <strong>${data.hours} hours</strong> of service exchange`,
        barPct: Math.min(100, Math.round((data.credits / 400) * 100)),
        series: data.series.monthlyCredits,
        unitShort: "CR",
      },
      {
        icon: "🌱",
        label: "CO₂ Saved",
        value: data.savedKg,
        unit: "kg",
        sub: `<strong>CO₂</strong> avoided versus the baseline alternative`,
        barPct: Math.min(100, Math.round((data.savedKg / 300) * 100)),
        series: data.series.cumulativeSavedKg,
        unitShort: "KG",
      },
      {
        icon: "🌳",
        label: "Trees Equivalent",
        value: data.treesEquivalent,
        unit: "trees",
        sub: `Based on <strong>21 kg CO₂ / tree / year</strong> absorption`,
        barPct: Math.min(100, Math.round((data.treesEquivalent / 15) * 100)),
        series: data.series.cumulativeSavedKg.map((v) => Math.floor(v / 21)),
        unitShort: "TREES",
      },
      {
        icon: "🏅",
        label: "Points",
        value: data.points,
        unit: "pts",
        sub: `Current tier: <strong>${data.badge.label}</strong>`,
        barPct: Math.min(100, Math.round((data.points / 700) * 100)),
        series: data.series.monthlyEmissionsKg,
        unitShort: "PTS",
      },
    ];
  }, [data]);

  useEffect(() => {
    if (!cards.length) return;
    const cleanups = [];
    cards.forEach((c, i) => {
      const el = numberRefs.current[i];
      if (!el) return;
      const target = c.value;
      const start = performance.now();
      const delay = 200 + i * 120;
      const duration = 1100;
      const t = window.setTimeout(() => {
        const tick = (now) => {
          const p = Math.min((now - start - delay) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 4);
          el.textContent = String(Math.round(eased * target));
          if (p < 1) requestAnimationFrame(tick);
          else el.textContent = String(target);
        };
        requestAnimationFrame(tick);
      }, delay);
      cleanups.push(t);
    });
    const t2 = window.setTimeout(() => {
      document.querySelectorAll(".card-bar-fill").forEach((el, i) => {
        window.setTimeout(() => { el.style.width = (el.dataset.pct || "0") + "%"; }, i * 100);
      });
    }, 500);
    cleanups.push(t2);
    return () => cleanups.forEach((id) => clearTimeout(id));
  }, [cards]);

  if (loading) {
    return (
      <AppShell>
        <div className="boot-state">
          <div className="boot-ring" />
          <p>Loading your carbon and credit data…</p>
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="empty-state">
          <h3>Could not load your dashboard</h3>
          <p>{error}</p>
          <button className="btn btn--primary" onClick={load}>Try again</button>
        </div>
      </AppShell>
    );
  }

  const theme = cardThemes[activeCard];
  const hasData = data.activityCount > 0;
  const initial = (user?.firstName || data.user.name || "?").charAt(0).toUpperCase();

  return (
    <AppShell>
      <section className="profile">
        <div className="avatar-wrap">
          <div className="avatar-glow" />
          <svg className="avatar-ring-svg" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="54" stroke="rgba(34,197,94,0.35)" strokeWidth="1.5"
              strokeDasharray="8 5" strokeLinecap="round" />
            <circle cx="60" cy="60" r="54" stroke="url(#dashboardRingGrad)" strokeWidth="2.5"
              strokeDasharray="60 280" strokeLinecap="round" />
            <defs>
              <linearGradient id="dashboardRingGrad" gradientUnits="userSpaceOnUse" x1="60" y1="6" x2="60" y2="114">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
          <div className="avatar-img">{initial}</div>
        </div>

        <h1 className="profile-name">{user?.firstName ? `${user.firstName} ${user.lastName}` : data.user.name}</h1>
        <p className="profile-email">{user?.email || data.user.email}</p>
        <div className="badge">
          <div className="badge-dot" />
          <span className="badge-emoji">🌿</span>
          <span>{data.badge.label}</span>
        </div>
      </section>

      {!hasData && (
        <div className="empty-state">
          <h3>Your dashboard is waiting for data</h3>
          <p>
            Run the Carbon Calculator to log a trip, meal, or electricity use — or complete a
            Time Bank exchange, which creates a carbon record automatically for linked categories.
          </p>
          <div className="empty-actions">
            <Link to="/calculator" className="btn btn--primary">Open Carbon Calculator</Link>
            <Link to="/marketplace" className="btn btn--ghost">Browse Time Bank</Link>
          </div>
        </div>
      )}

      <div className="section-label"><span>Sustainability Stats</span></div>

      <section className="stats-grid">
        {cards.map((c, i) => (
          <button
            type="button"
            key={c.label}
            className={`card stat-card${activeCard === i ? " active" : ""}`}
            style={{ animationDelay: `${0.1 + i * 0.1}s` }}
            onClick={() => setActiveCard(i)}
            aria-pressed={activeCard === i}
          >
            <div className="card-header">
              <div className="card-icon">{c.icon}</div>
              <span className={`card-trend ${trendFor(c.series).dir}`}>{trendFor(c.series).text}</span>
            </div>
            <p className="card-label">{c.label}</p>
            <div className="card-value-row">
              <span className="card-number" ref={(el) => (numberRefs.current[i] = el)}>0</span>
              {c.unit && <span className="card-unit">{c.unit}</span>}
            </div>
            <p className="card-sub" dangerouslySetInnerHTML={{ __html: c.sub }} />
            <div className="card-bar-track">
              <div className="card-bar-fill" style={{ width: "0%" }} data-pct={c.barPct} />
            </div>
          </button>
        ))}
      </section>

      <div className="section-label"><span>Execution Flow</span></div>

      <section className="card spline-card" style={{ animationDelay: "0.5s", "--ca": theme.ca, "--ca-lt": theme.caLt, "--ca-rgb": theme.rgb }}>
        <div className="card-header">
          <div className="card-icon">📈</div>
          <span className="card-trend up">LIVE</span>
        </div>
        <p className="card-label">{cards[activeCard]?.label} · Flow Trace</p>
        {cards[activeCard] && (
          <SplineAreaChart
            series={cards[activeCard].series}
            theme={theme}
            unitShort={cards[activeCard].unitShort}
            label={cards[activeCard].label}
          />
        )}
      </section>

      {data.byDomain.length > 0 && (
        <>
          <div className="section-label"><span>Emissions By Domain</span></div>
          <section className="panel">
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {data.byDomain.map((d) => {
                const total = data.byDomain.reduce((a, b) => a + b.emissionsKg, 0) || 1;
                const pct = Math.round((d.emissionsKg / total) * 100);
                return (
                  <div key={d.domain} className="domain-row">
                    <div className="domain-head">
                      <span>{DOMAIN_LABEL[d.domain] || d.domain}</span>
                      <strong>{d.emissionsKg} kg</strong>
                    </div>
                    <div className="domain-track"><div className="domain-fill" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
