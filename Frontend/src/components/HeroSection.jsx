import { useEffect, useMemo, useState } from "react";
import {
  Leaf,
  Zap,
  Car,
  UtensilsCrossed,
  ShoppingBag,
  TrendingDown,
  Sparkles,
  Plug,
  ArrowRight,
  Play,
} from "lucide-react";

/* ============ 3D cubes ============ */
const Cube3D = ({ size, accent }) => {
  const half = size / 2;
  const faces = [
    `translateZ(${half}px)`,
    `rotateY(180deg) translateZ(${half}px)`,
    `rotateY(90deg) translateZ(${half}px)`,
    `rotateY(-90deg) translateZ(${half}px)`,
    `rotateX(90deg) translateZ(${half}px)`,
    `rotateX(-90deg) translateZ(${half}px)`,
  ];
  return (
    <div
      className={`cc-cube-3d ${accent ? "cc-cube--accent" : ""}`}
      style={{ width: size, height: size }}
    >
      {faces.map((t, i) => (
        <div key={i} className="cc-cube-face" style={{ transform: t }} />
      ))}
    </div>
  );
};

const FloatingCubes = ({ count = 24, accentChance = 0.35 }) => {
  const cubes = useMemo(() => {
    const rnd = (seed) => {
      const x = Math.sin(seed * 9301 + 49297) * 233280;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }).map((_, i) => {
      const depth = -120 + rnd(i + 4) * 240;
      return {
        size: 8 + Math.floor(rnd(i + 1) * 22),
        left: rnd(i + 2) * 100,
        top: rnd(i + 3) * 100,
        depthFrom: depth - 80,
        depthTo: depth,
        duration: 6 + rnd(i + 5) * 8,
        delay: rnd(i + 6) * 4,
        driftX: -30 + rnd(i + 7) * 60,
        driftY: -30 + rnd(i + 8) * 60,
        rotX: 180 + rnd(i + 9) * 360,
        rotY: 180 + rnd(i + 10) * 360,
        accent: rnd(i + 11) < accentChance,
        opacity: 0.35 + rnd(i + 12) * 0.5,
      };
    });
  }, [count, accentChance]);

  return (
    <div className="cc-cubes" aria-hidden>
      {cubes.map((c, i) => (
        <div
          key={i}
          className="cc-cube"
          style={{
            left: `${c.left}%`,
            top: `${c.top}%`,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
            "--drift-x": `${c.driftX}px`,
            "--drift-y": `${c.driftY}px`,
            "--depth-from": `${c.depthFrom}px`,
            "--depth-to": `${c.depthTo}px`,
            "--rot-x": `${c.rotX}deg`,
            "--rot-y": `${c.rotY}deg`,
            "--cube-opacity": c.opacity,
          }}
        >
          <Cube3D size={c.size} accent={c.accent} />
        </div>
      ))}
    </div>
  );
};

/* ============ Animated number ============ */
const AnimatedNumber = ({ value, decimals = 1 }) => {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const start = display;
    const delta = value - start;
    const duration = 800;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(start + delta * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span>{display.toFixed(decimals)}</span>;
};

/* ============ Formula data ============ */
const blocks = [
  { id: "core", icon: Leaf, label: "Core", formula: { a: "Activity", b: "Emission Factor", op: "×" }, factor: 1, unit: "kg CO₂", x: 4, y: 4, w: 56, h: 26, baseInput: 12.4 },
  { id: "transport", icon: Car, label: "Transport", formula: { a: "Distance", b: "0.21", op: "×" }, factor: 0.21, unit: "kg", x: 64, y: 4, w: 32, h: 26, baseInput: 18 },
  { id: "electricity", icon: Plug, label: "Electricity", formula: { a: "kWh", b: "0.7", op: "×" }, factor: 0.7, unit: "kg", x: 4, y: 34, w: 30, h: 26, baseInput: 9 },
  { id: "food", icon: UtensilsCrossed, label: "Food", formula: { a: "Meals", b: "1.4", op: "×" }, factor: 1.4, unit: "kg", x: 36, y: 34, w: 30, h: 26, baseInput: 3 },
  { id: "consumption", icon: ShoppingBag, label: "Consumption", formula: { a: "Items", b: "2.1", op: "×" }, factor: 2.1, unit: "kg", x: 68, y: 34, w: 28, h: 26, baseInput: 2 },
  { id: "ev", icon: Zap, label: "EV Formula", formula: { a: "Distance × Energy/km", b: "Grid factor", op: "×" }, factor: 0.45, unit: "kg", x: 4, y: 64, w: 92, h: 30, baseInput: 24 },
];

const FormulaCard = ({ block, active, index }) => {
  const Icon = block.icon;
  const [input, setInput] = useState(block.baseInput);
  useEffect(() => {
    const id = setInterval(() => {
      const jitter = (Math.sin(Date.now() / 1400 + index) + 1) / 2;
      setInput(+(block.baseInput * (0.7 + jitter * 0.6)).toFixed(2));
    }, 1100 + index * 130);
    return () => clearInterval(id);
  }, [block.baseInput, index]);

  const result = +(input * block.factor).toFixed(2);
  const barPct = Math.min(100, (result / (block.baseInput * block.factor * 1.4)) * 100);

  return (
    <div
      className={`cc-fcard ${active ? "is-active" : ""}`}
      style={{
        left: `${block.x}%`,
        top: `${block.y}%`,
        width: `${block.w}%`,
        height: `${block.h}%`,
        animationDelay: `${0.4 + index * 0.12}s`,
      }}
    >
      <div className="cc-fcard-inner" style={{ animationDelay: `${index * 0.4}s` }}>
        <div className="cc-fcard-tape" aria-hidden />
        {active && <div className="cc-fcard-sweep" aria-hidden />}

        <div className="cc-fcard-head">
          <div className="cc-fcard-head-l">
            <div className="cc-fcard-icon">
              <Icon size={12} />
            </div>
            <span className="cc-fcard-label">{block.label}</span>
          </div>
          {active && <span className="cc-fcard-badge">CALC</span>}
        </div>

        <div className="cc-fcard-body">
          <div className="cc-fcard-formula">
            <span className="cc-fpiece">{block.formula.a}</span>
            <span className="cc-fop">{block.formula.op}</span>
            <span className="cc-fpiece cc-fpiece--accent">{block.formula.b}</span>
            <span className="cc-fop">=</span>
            <span className="cc-fresult" key={result}>
              <AnimatedNumber value={result} decimals={2} /> {block.unit}
            </span>
          </div>

          <div className="cc-fbar">
            <div className="cc-fbar-fill" style={{ width: `${barPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============ Whiteboard panel ============ */
const CarbonGridPanel = () => {
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActiveIdx((i) => (i + 1) % blocks.length), 1800);
    return () => clearInterval(id);
  }, []);

  const totalSaved = 12.4;

  return (
    <div className="cc-panel cc-panel-floats">
      <div className="cc-panel-glow" aria-hidden />

      <div className="cc-panel-cubes-bg">
        <FloatingCubes count={26} accentChance={0.4} />
      </div>

      <div className="cc-panel-sparkle" aria-hidden>
        <Sparkles size={24} />
      </div>

      <div className="cc-whiteboard">
        <div className="cc-whiteboard-grid" aria-hidden />

        <div className="cc-ink-dots" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              style={{
                left: `${10 + (i * 11) % 80}%`,
                top: `${15 + (i * 17) % 70}%`,
                animationDelay: `${i * 0.4}s`,
                animationDuration: `${3 + (i % 3)}s`,
              }}
            />
          ))}
        </div>

        <div className="cc-wb-head">
          <div className="cc-wb-head-l">
            <div className="cc-wb-leaf">
              <Leaf size={14} />
            </div>
            <div className="cc-wb-head-title">
              <small>Whiteboard</small>
              <strong>Carbon Calculation</strong>
            </div>
          </div>
          <div className="cc-wb-head-r">
            <div className="cc-wb-saved">
              <small>Saved</small>
              <strong>
                <AnimatedNumber value={totalSaved} /> kg
              </strong>
              <TrendingDown size={12} color="#1a4d22" />
            </div>
            <div className="cc-wb-live">
              <span className="cc-pulse" />
              <span>Live</span>
            </div>
          </div>
        </div>

        <div className="cc-wb-area">
          {blocks.map((b, i) => (
            <FormulaCard key={b.id} block={b} index={i} active={activeIdx === i} />
          ))}

          <svg className="cc-wb-svg" aria-hidden>
            <defs>
              <linearGradient id="ccLineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#a3e635" stopOpacity="0.1" />
                <stop offset="50%" stopColor="#a3e635" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#a3e635" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            {blocks.map((b, i) => {
              if (i === 0) return null;
              const core = blocks[0];
              const x1 = core.x + core.w / 2;
              const y1 = core.y + core.h / 2;
              const x2 = b.x + b.w / 2;
              const y2 = b.y + b.h / 2;
              return (
                <line
                  key={b.id}
                  className={`cc-wb-line ${activeIdx === i ? "is-active" : ""}`}
                  x1={`${x1}%`}
                  y1={`${y1}%`}
                  x2={`${x2}%`}
                  y2={`${y2}%`}
                />
              );
            })}
          </svg>
        </div>

        <div className="cc-panel-cubes-fg">
          <FloatingCubes count={8} accentChance={0.6} />
        </div>
      </div>
    </div>
  );
};

/* ============ Hero left content ============ */
const HeroContent = () => {
  return (
    <div className="cc-hero-content">
      <span className="cc-hero-eyebrow">
        <span className="cc-eyebrow-dot" />
        Environmental Prestige
      </span>

      <h1 className="cc-hero-title">
        <span className="track-yes">TRACK YOUR IMPACT.</span>
        <br />
        <span className="cc-accent">Build a Sustainable Future.</span>
      </h1>

      <p className="cc-hero-desc">
        CarbonClock transforms your daily habits into measurable environmental
        outcomes. Earn rewards, track your CO<sub>2</sub> reduction, and join a
        global movement.
      </p>

      <div className="cc-hero-actions">
        <button className="cc-btn cc-btn--ghost">
          <Play size={18} />
          View Demo
        </button>
      </div>

      <div className="cc-trust">
        <div className="cc-trust-avatars">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                background: `linear-gradient(135deg, hsl(${80 + i * 20} 70% 55%), hsl(${140 + i * 10} 60% 45%))`,
              }}
            />
          ))}
        </div>
        <span>
          Trusted by <strong>12,400+</strong> eco-citizens
        </span>
      </div>
    </div>
  );
};

/* ============ Hero section root ============ */
export default function HeroSection() {
  return (
    <section className="cc-hero-section">
      <div className="cc-blob cc-blob--tl" aria-hidden />
      <div className="cc-blob cc-blob--br" aria-hidden />

      <div className="cc-hero-grid">
        <HeroContent />
        <div className="cc-panel-wrap">
          <CarbonGridPanel />
        </div>
      </div>
    </section>
  );
}
