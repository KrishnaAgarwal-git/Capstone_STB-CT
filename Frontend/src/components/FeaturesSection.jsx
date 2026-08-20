
const FeaturesSection = () => {
  return (
    <section className="stb-features">
      <div className="stb-features__inner">
        {/* ---------- Header ---------- */}
        <div className="stb-features__head">
          <h2 className="stb-features__title">
            Your Sustainable{" "}
            <span className="stb-features__title-accent">LIVING</span> Toolkit
          </h2>
          <p className="stb-features__lede">
            A quiet ecosystem where time, carbon and community converge — track your footprint, exchange hours with friends, and let gentle intelligence guide every greener choice.
          </p>
        </div>

        {/* ---------- Top row: 1 hero + 1 wide ---------- */}
        <div className="stb-features__row stb-features__row--top">
          {/* Hero — Time Banking (analog clock + floating credits + hand silhouettes) */}
          <article className="stb-feature stb-feature--hero">
            <div className="stb-feature__art stb-feature__art--time">
              <div className="stb-time-scene">
                <div className="stb-time-orbit" aria-hidden="true">
                  <span className="stb-time-orbit__ring" />
                  <span className="stb-time-orbit__ring stb-time-orbit__ring--two" />
                </div>

                <div className="stb-clock">
                  <div className="stb-clock__face">
                    {[...Array(12)].map((_, i) => (
                      <span
                        key={i}
                        className={`stb-clock__tick ${i % 3 === 0 ? "stb-clock__tick--major" : ""}`}
                        style={{ transform: `rotate(${i * 30}deg)` }}
                      />
                    ))}
                    <span className="stb-clock__hand stb-clock__hand--hour" />
                    <span className="stb-clock__hand stb-clock__hand--min" />
                    <span className="stb-clock__center" />
                  </div>
                </div>

                <div className="stb-time-credit stb-time-credit--one">
                  <span>+1h</span>
                </div>
                <div className="stb-time-credit stb-time-credit--two">
                  <span>+30m</span>
                </div>
                <div className="stb-time-credit stb-time-credit--three">
                  <span>+2h</span>
                </div>

                <svg className="stb-time-leaf" viewBox="0 0 80 80" aria-hidden="true">
                  <path
                    d="M64 14C36 14 18 30 18 54c0 4 1 8 2 10 3-18 17-31 36-35-14 7-25 20-27 36 4 1 8 2 12 2 22 0 38-16 38-38 0-7-2-12-4-15-3 0-7 0-11 0z"
                    fill="currentColor"
                  />
                </svg>
              </div>
            </div>
            <span className="stb-feature__pill">Time Banking</span>
          </article>

          {/* Wide — Carbon (donut + breakdown bars) */}
          <article className="stb-feature stb-feature--wide">
            <div className="stb-feature__art stb-feature__art--carbon">
              <div className="stb-carbon">
                <div className="stb-carbon__donut" aria-hidden="true">
                  <svg viewBox="0 0 120 120">
                    <defs>
                      <linearGradient id="stbDonut" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#cdd3ad" />
                        <stop offset="60%" stopColor="#879267" />
                        <stop offset="100%" stopColor="#c9a24a" />
                      </linearGradient>
                    </defs>
                    <circle cx="60" cy="60" r="48" stroke="rgba(244,245,236,0.08)" strokeWidth="14" fill="none" />
                    <circle
                      cx="60" cy="60" r="48"
                      stroke="url(#stbDonut)" strokeWidth="14"
                      fill="none" strokeLinecap="round"
                      strokeDasharray="301.6" strokeDashoffset="90"
                      transform="rotate(-90 60 60)"
                      className="stb-carbon__ring"
                    />
                  </svg>
                  <div className="stb-carbon__center">
                    <strong>1.8t</strong>
                    <small>CO₂ / mo</small>
                    <span className="stb-carbon__delta">↓ 18%</span>
                  </div>
                </div>

                <div className="stb-meter">
                  <div className="stb-meter__head">
                    <span className="stb-meter__dot" />
                    <span className="stb-meter__title">Footprint Mix</span>
                  </div>
                  <div className="stb-meter__bars">
                    <div className="stb-meter__row">
                      <span>Transport</span>
                      <div className="stb-meter__track">
                        <div className="stb-meter__fill" style={{ width: "62%" }} />
                      </div>
                      <em>0.6t</em>
                    </div>
                    <div className="stb-meter__row">
                      <span>Energy</span>
                      <div className="stb-meter__track">
                        <div className="stb-meter__fill" style={{ width: "44%" }} />
                      </div>
                      <em>0.4t</em>
                    </div>
                    <div className="stb-meter__row">
                      <span>Food</span>
                      <div className="stb-meter__track">
                        <div className="stb-meter__fill" style={{ width: "78%" }} />
                      </div>
                      <em>0.5t</em>
                    </div>
                    <div className="stb-meter__row">
                      <span>Goods</span>
                      <div className="stb-meter__track">
                        <div className="stb-meter__fill" style={{ width: "33%" }} />
                      </div>
                      <em>0.3t</em>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <span className="stb-feature__pill">Carbon Footprint Tracking</span>
          </article>
        </div>

        {/* ---------- Bottom row: 3 cards ---------- */}
        <div className="stb-features__row stb-features__row--bottom">
          {/* Credit Exchange — abstract avatars + flowing token */}
          <article className="stb-feature">
            <div className="stb-feature__art stb-feature__art--exchange">
              <div className="stb-exchange">
                <svg className="stb-exchange__svg" viewBox="0 0 260 160" aria-hidden="true">
                  <defs>
                    <radialGradient id="stbAvA" cx="0.3" cy="0.3" r="0.8">
                      <stop offset="0%" stopColor="#f6f5ec" />
                      <stop offset="100%" stopColor="#aab487" />
                    </radialGradient>
                    <radialGradient id="stbAvB" cx="0.3" cy="0.3" r="0.8">
                      <stop offset="0%" stopColor="#e7ead6" />
                      <stop offset="100%" stopColor="#879267" />
                    </radialGradient>
                  </defs>

                  {/* Left avatar silhouette */}
                  <g transform="translate(20 50)">
                    <circle cx="28" cy="22" r="14" fill="url(#stbAvA)" />
                    <path d="M4 70c0-14 11-24 24-24s24 10 24 24" fill="url(#stbAvA)" opacity="0.85" />
                  </g>
                  {/* Right avatar silhouette */}
                  <g transform="translate(180 50)">
                    <circle cx="28" cy="22" r="14" fill="url(#stbAvB)" />
                    <path d="M4 70c0-14 11-24 24-24s24 10 24 24" fill="url(#stbAvB)" opacity="0.85" />
                  </g>

                  {/* Arc */}
                  <path
                    d="M55 70 Q130 -10 205 70"
                    stroke="#cdd3ad"
                    strokeWidth="1.4"
                    fill="none"
                    strokeDasharray="4 5"
                    opacity="0.7"
                  />
                  {/* Token traveling along arc */}
                  <circle r="9" fill="#c9a24a" className="stb-exchange__token">
                    <animateMotion dur="3.6s" repeatCount="indefinite" path="M55 70 Q130 -10 205 70" />
                  </circle>
                  <circle r="14" fill="#c9a24a" opacity="0.18" className="stb-exchange__token-glow">
                    <animateMotion dur="3.6s" repeatCount="indefinite" path="M55 70 Q130 -10 205 70" />
                  </circle>
                </svg>

                <div className="stb-exchange__chips">
                  <span className="stb-exchange__chip">2 hrs</span>
                  <span className="stb-exchange__arrow">↔</span>
                  <span className="stb-exchange__chip stb-exchange__chip--gold">20 credits</span>
                </div>
              </div>
            </div>
            <span className="stb-feature__pill">Credit Exchange</span>
          </article>

          {/* AI Recommendations — orb + sparkline + suggestions */}
          <article className="stb-feature">
            <div className="stb-feature__art stb-feature__art--ai">
              <div className="stb-ai">
                <div className="stb-ai__top">
                  <div className="stb-ai__orb">
                    <span className="stb-ai__ring" />
                    <span className="stb-ai__ring stb-ai__ring--two" />
                    <span className="stb-ai__core">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M12 2l2.5 5.5L20 10l-5.5 2.5L12 18l-2.5-5.5L4 10l5.5-2.5z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                  </div>
                  <svg className="stb-ai__spark" viewBox="0 0 120 40" aria-hidden="true">
                    <path
                      d="M2 30 L18 22 L34 26 L50 14 L66 18 L82 8 L100 12 L118 4"
                      stroke="#cdd3ad"
                      strokeWidth="1.6"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M2 30 L18 22 L34 26 L50 14 L66 18 L82 8 L100 12 L118 4 L118 40 L2 40 Z"
                      fill="rgba(205,211,173,0.12)"
                    />
                    <circle cx="118" cy="4" r="3" fill="#c9a24a" />
                  </svg>
                </div>
                <ul className="stb-ai__suggestions">
                  <li>
                    <span className="stb-ai__bullet" />
                    Cycle to market — save 1.2 kg CO₂
                  </li>
                  <li>
                    <span className="stb-ai__bullet" />
                    Offer 1 hr gardening to a friend
                  </li>
                  <li>
                    <span className="stb-ai__bullet" />
                    Switch to off-peak laundry
                  </li>
                </ul>
              </div>
            </div>
            <span className="stb-feature__pill">AI Recommendations</span>
          </article>

          {/* Achievements & Leaderboard */}
          <article className="stb-feature">
            <div className="stb-feature__art stb-feature__art--rewards">
              <div className="stb-leader">
                <div className="stb-leader__podium" aria-hidden="true">
                  <div className="stb-leader__col stb-leader__col--2">
                    <span className="stb-leader__medal">2</span>
                    <div className="stb-leader__bar" />
                  </div>
                  <div className="stb-leader__col stb-leader__col--1">
                    <svg className="stb-leader__crown" viewBox="0 0 32 24" aria-hidden="true">
                      <path
                        d="M2 22l3-14 6 8 5-12 5 12 6-8 3 14z"
                        fill="currentColor"
                      />
                    </svg>
                    <span className="stb-leader__medal stb-leader__medal--gold">1</span>
                    <div className="stb-leader__bar" />
                  </div>
                  <div className="stb-leader__col stb-leader__col--3">
                    <span className="stb-leader__medal">3</span>
                    <div className="stb-leader__bar" />
                  </div>
                </div>

                <div className="stb-leader__list">
                  <div className="stb-leader__row stb-leader__row--top">
                    <span className="stb-leader__rank">01</span>
                    <span className="stb-leader__name">Your Friend</span>
                    <span className="stb-leader__score">2,840</span>
                  </div>
                  <div className="stb-leader__row stb-leader__row--you">
                    <span className="stb-leader__rank">04</span>
                    <span className="stb-leader__name">You</span>
                    <span className="stb-leader__score">1,920</span>
                  </div>
                </div>
              </div>
            </div>
            <span className="stb-feature__pill">Achievements &amp; Leaderboard</span>
          </article>
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
