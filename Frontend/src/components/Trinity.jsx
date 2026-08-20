import { useState, useEffect } from "react";

/* ---------- Icons (inline SVG, no deps) ---------- */
const LeafIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c.8 3.36.5 7.18-2.2 10.04C14.5 15.4 12 17 11 20z"/>
    <path d="M2 22c1.5-3 4-5 7-7"/>
  </svg>
);
const ClockIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const SparkIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5z"/>
  </svg>
);
const CloseIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" {...p}>
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

/* ---------- Main component ---------- */
export default function Trinity() {
  const [open, setOpen] = useState(null); // 'carbon' | 'time' | 'ai' | null

  // Close on ESC
  useEffect(() => {
    const fn = (e) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  return (
    <section className="cs-section">
      <div className="cs-grid">
        {/* LEFT */}
        <div className="cs-left">
          <h1 className="cs-headline">
            THE CORE <span className="cs-tag">SUITE</span>
          </h1>

          <div className="cs-eyebrow">
            <span className="cs-eyebrow-line" />
            <span>Professional Environment Suite</span>
          </div>

          <p className="cs-desc">
            Secure, professional-grade sandbox environments tailored for
            essential modern developer tools. Track impact, bank time, get
            intelligent guidance.
          </p>

          <div className="cs-stats">
            <Stat value="12.4" unit="kg" label="CO₂ Saved Today" />
            <Stat value="45" unit=":12" label="Hours Banked" />
            <Stat value="94.7" unit="%" label="AI Accuracy" />
          </div>
        </div>

        {/* RIGHT — clickable cards */}
        <div className="cs-cards">
          <SuiteCard
            tone="green"
            icon={<LeafIcon width={16} height={16} />}
            title="CARBON CALC"
            subtitle="Real-time emission tracking"
            statLabel="Current CO₂ Savings"
            statValue="12.4kg"
            badge="LIVE"
            sideTop="↑ 2.1kg"
            sideBottom="today"
            progress={62}
            onClick={() => setOpen("carbon")}
          />
          <SuiteCard
            tone="amber"
            icon={<ClockIcon width={16} height={16} />}
            title="TIME BANK"
            subtitle="Banked time management system"
            statLabel="Banked Hours"
            statValue="45:12"
            badge="LIVE"
            sideTop="+3hrs"
            sideBottom="this week"
            progress={48}
            onClick={() => setOpen("time")}
          />
          <SuiteCard
            tone="blue"
            icon={<SparkIcon width={16} height={16} />}
            title="AI INSIGHTS"
            subtitle="Intelligent workflow suggestions"
            statLabel="Recommendation Accuracy"
            statValue="94.7%"
            badge="BETA"
            sideTop="Dynamic"
            sideBottom="Glassmorphism Workshop"
            progress={94}
            onClick={() => setOpen("ai")}
          />
        </div>
      </div>

      {/* Detail dialogs */}
      <DetailDialog
        open={open === "carbon"} onClose={() => setOpen(null)}
        tone="green" icon={<LeafIcon width={18} height={18} />} title="CARBON CALC"
        kpis={[
          { label: "Today's Savings", value: "12.4 kg", note: "↑ 18% vs yesterday" },
          { label: "Monthly Total",  value: "284 kg",  note: "Goal: 300 kg" },
          { label: "Offset Score",   value: "94.7",    note: "Excellent rating" },
        ]}
        bars={[40, 60, 30, 75, 55, 82, 100]}
        chartLabel="Daily CO₂ Savings — Last 7 Days"
      />
      <DetailDialog
        open={open === "time"} onClose={() => setOpen(null)}
        tone="amber" icon={<ClockIcon width={18} height={18} />} title="TIME BANK"
        kpis={[
          { label: "Banked Hours",    value: "45:12", note: "+3h this week" },
          { label: "Active Sessions", value: "7",     note: "Across 3 projects" },
          { label: "Efficiency",      value: "87%",   note: "↑ 5% vs last month" },
        ]}
        bars={[35, 55, 42, 70, 58, 60, 95]}
        chartLabel="Hours Banked — Last 7 Days"
      />
      <DetailDialog
        open={open === "ai"} onClose={() => setOpen(null)}
        tone="blue" icon={<SparkIcon width={18} height={18} />} title="AI INSIGHTS"
        kpis={[
          { label: "Accuracy",    value: "94.7%", note: "↑ 2.3% this week" },
          { label: "Suggestions", value: "127",   note: "98 accepted" },
          { label: "Time Saved",  value: "12h",   note: "This month" },
        ]}
        bars={[50, 68, 72, 80, 88, 91, 96]}
        chartLabel="Recommendation Accuracy — Last 7 Days"
      />
    </section>
  );
}

/* ---------- Stat ---------- */
function Stat({ value, unit, label }) {
  return (
    <div className="cs-stat">
      <div className="cs-stat-value">
        {value}
        {unit && <span className="cs-stat-unit">{unit}</span>}
      </div>
      <div className="cs-stat-label">{label}</div>
    </div>
  );
}

/* ---------- Card ---------- */
function SuiteCard({
  tone, icon, title, subtitle, statLabel, statValue,
  badge, sideTop, sideBottom, progress, onClick,
}) {
  return (
    <button className={`cs-card cs-card--${tone}`} onClick={onClick}>
      <div className="cs-card-row">
        <div className="cs-card-icon">{icon}</div>
        <div className="cs-card-body">
          <div className="cs-card-head">
            <div>
              <h3 className="cs-card-title">{title}</h3>
              <p className="cs-card-sub">{subtitle}</p>
            </div>
            <span className="cs-badge">
              <span className="cs-badge-dot" />
              {badge}
            </span>
          </div>

          <div className="cs-card-stat-row">
            <div className="cs-card-stat">
              <span className="cs-card-stat-label">{statLabel}</span>
              <span className="cs-card-stat-value">{statValue}</span>
            </div>
            {(sideTop || sideBottom) && (
              <div className="cs-side">
                <div>{sideTop}</div>
                <div>{sideBottom}</div>
              </div>
            )}
          </div>

          {typeof progress === "number" && (
            <div className="cs-progress-track">
              <div className="cs-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/* ---------- Dialog ---------- */
function DetailDialog({ open, onClose, tone, icon, title, kpis, bars, chartLabel }) {
  if (!open) return null;
  return (
    <div className="cs-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`cs-dialog cs-card--${tone}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cs-dialog-head">
          <div className="cs-dialog-title">
            <span className="cs-card-icon">{icon}</span>
            {title}
          </div>
          <button className="cs-close" onClick={onClose} aria-label="Close">
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className="cs-kpis">
          {kpis.map((k) => (
            <div key={k.label} className="cs-kpi">
              <div className="cs-kpi-label">{k.label}</div>
              <div className="cs-kpi-value">{k.value}</div>
              <div className="cs-kpi-note">{k.note}</div>
            </div>
          ))}
        </div>

        <div className="cs-chart">
          <div className="cs-bars">
            {bars.map((h, i) => (
              <div
                key={i}
                className="cs-bar"
                style={{
                  height: `${h}%`,
                  opacity: 0.55 + (i / bars.length) * 0.45,
                  boxShadow:
                    i === bars.length - 1 ? "0 0 30px var(--cs-accent-glow)" : "none",
                }}
              />
            ))}
          </div>
          <div className="cs-chart-label">{chartLabel}</div>
        </div>
      </div>
    </div>
  );
}