import React from "react";

const stats = [
  {
    id: 1,
    value: "1 hr",
    unit: "= 10 Credits",
    label: "Time Banking Equity",
    description:
      "Every hour of help shared between friends carries equal value, regardless of skill.",
    accent: "leaf",
  },
  {
    id: 2,
    value: "4",
    unit: "Domains",
    label: "Carbon Footprint Tracking",
    description:
      "Transport, electricity, food and consumption mirrored into one living footprint.",
    accent: "moss",
  },
  {
    id: 3,
    value: "100%",
    unit: "Community Driven",
    label: "Eco Rewards",
    description:
      "Achievements, leaderboards and recognition that turn green habits into shared wins.",
    accent: "sage",
  },
];

const StatsSection = () => {
  return (
    <section className="stb-stats">
      <div className="stb-stats__inner">
        <div className="stb-stats__header">
          <span className="stb-stats__chip">
            <span className="stb-stats__chip-dot" />
            Impact Snapshot
          </span>
          <h2 className="stb-stats__title">
            Small acts, <em>measured</em> together.
          </h2>
          <p className="stb-stats__lede">
            STB-DTC weaves time, carbon and community into a single quiet
            rhythm — so helping a neighbour and lowering your footprint become
            the same gesture.
          </p>
        </div>

        <div className="stb-stats__grid">
          {stats.map((s, i) => (
            <article
              key={s.id}
              className={`stb-stat stb-stat--${s.accent}`}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <div className="stb-stat__index">0{s.id}</div>

              <div className="stb-stat__value">
                <span className="stb-stat__number">{s.value}</span>
                <span className="stb-stat__unit">{s.unit}</span>
              </div>

              <div className="stb-stat__rule" aria-hidden="true">
                <span />
              </div>

              <h3 className="stb-stat__label">{s.label}</h3>
              <p className="stb-stat__desc">{s.description}</p>

              <svg
                className="stb-stat__leaf"
                viewBox="0 0 64 64"
                aria-hidden="true"
              >
                <path
                  d="M52 12C30 12 14 26 14 46c0 4 1 7 2 9 2-15 14-26 30-30-12 6-21 17-23 31 3 1 7 2 11 2 18 0 32-14 32-32 0-6-2-11-4-14-2 0-6 0-10 0z"
                  fill="currentColor"
                  opacity="0.18"
                />
                <path
                  d="M16 55C22 38 34 28 50 24"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  fill="none"
                  opacity="0.5"
                />
              </svg>
            </article>
          ))}
        </div>

        <div className="stb-stats__footnote">
          <span className="stb-stats__pulse" />
          A mutually reinforcing cycle — support a friend, soften your
          footprint, grow the grove.
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
