import { useMemo, useRef, useState } from "react";

/* Catmull-Rom -> cubic Bezier smooth path — identical to the original Dashboard's chart */
export function buildSmoothPath(values, width, height, padY = 8, invert = false) {
  if (!values || values.length === 0) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1 || 1);
  const pts = values.map((v, i) => {
    const norm = (v - min) / range;
    const t = invert ? norm : 1 - norm;
    return { x: i * stepX, y: padY + (height - padY * 2) * t };
  });

  let line = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    line += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  const area = `${line} L ${width},${height} L 0,${height} Z`;
  return { line, area, lastPoint: pts[pts.length - 1] };
}

/**
 * Same visual behaviour as the original inline SplineAreaChart: pointer
 * tracking along the actual SVG path length, glowing dot, floating value
 * tooltip, and the avg/peak/channel meta row underneath.
 */
export default function SplineAreaChart({ series, theme, unitShort, label, invert = false }) {
  const W = 800;
  const H = 220;
  const values = series && series.length ? series : [0, 0];

  const { line, area, lastPoint } = useMemo(
    () => buildSmoothPath(values, W, H, 14, invert),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(values), invert]
  );

  const gradId = `spline-grad-${theme.ca.replace("#", "")}`;
  const glowId = `spline-glow-${theme.ca.replace("#", "")}`;

  const svgRef = useRef(null);
  const lineRef = useRef(null);
  const [hover, setHover] = useState(null);

  const range = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max };
  }, [values]);

  const avg = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
  const peak = Math.max(...values);

  const handleMove = (e) => {
    const svg = svgRef.current;
    const path = lineRef.current;
    if (!svg || !path) return;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;

    const total = path.getTotalLength();
    let lo = 0;
    let hi = total;
    let best = path.getPointAtLength(0);
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const p = path.getPointAtLength(mid);
      if (p.x < vbX) lo = mid;
      else hi = mid;
      best = p;
    }
    const padY = 14;
    const usableH = H - padY * 2;
    const tNorm = (best.y - padY) / usableH;
    const t = invert ? tNorm : 1 - tNorm;
    const value = range.min + t * (range.max - range.min);
    setHover({ x: best.x, y: best.y, value });
  };

  const dotX = hover?.x ?? lastPoint?.x ?? 0;
  const dotY = hover?.y ?? lastPoint?.y ?? 0;
  const dotValue = hover?.value ?? values[values.length - 1];

  return (
    <div className="spline-wrap">
      <svg
        ref={svgRef}
        className="spline-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={theme.ca} stopOpacity="0.42" />
            <stop offset="60%" stopColor={theme.ca} stopOpacity="0.10" />
            <stop offset="100%" stopColor={theme.ca} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1="0" x2={W} y1={H * t} y2={H * t}
            stroke={`rgba(${theme.rgb},0.08)`} strokeDasharray="3 6" />
        ))}

        <path className="spline-area" d={area} fill={`url(#${gradId})`} />
        <path ref={lineRef} className="spline-line" d={line} fill="none"
          stroke={theme.ca} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          filter={`url(#${glowId})`} />

        {hover && (
          <line className="spline-tracker" x1={hover.x} x2={hover.x} y1={0} y2={H}
            stroke={theme.ca} strokeOpacity="0.35" strokeDasharray="3 4" />
        )}

        <circle className="spline-dot-halo" cx={dotX} cy={dotY} r="9" fill={`rgba(${theme.rgb},0.18)`} />
        <circle className="spline-dot" cx={dotX} cy={dotY} r="4" fill={theme.ca} />

        {hover && (
          <g className="spline-tooltip"
            transform={`translate(${Math.min(Math.max(hover.x, 50), W - 50)}, ${Math.max(hover.y - 22, 14)})`}>
            <rect x="-44" y="-18" width="88" height="26" rx="8" fill="rgba(6,9,8,0.9)"
              stroke={theme.ca} strokeOpacity="0.55" />
            <text x="0" y="0" textAnchor="middle" fill={theme.caLt}
              fontFamily="'Space Mono', monospace" fontSize="13" fontWeight="700">
              {Math.round(dotValue)} {unitShort}
            </text>
          </g>
        )}
      </svg>

      <div className="spline-meta">
        <div className="spline-meta-item">
          <span className="spline-meta-label">AVG. LOAD</span>
          <span className="spline-meta-value" style={{ color: theme.caLt }}>
            {avg}<em>{unitShort}</em>
          </span>
        </div>
        <div className="spline-meta-divider" />
        <div className="spline-meta-item">
          <span className="spline-meta-label">PEAK LOAD</span>
          <span className="spline-meta-value" style={{ color: theme.caLt }}>
            {peak}<em>{unitShort}</em>
          </span>
        </div>
        <div className="spline-meta-divider" />
        <div className="spline-meta-item">
          <span className="spline-meta-label">CHANNEL</span>
          <span className="spline-meta-value" style={{ color: theme.caLt }}>
            {label?.toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
}
