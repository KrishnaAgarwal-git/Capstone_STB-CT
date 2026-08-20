import { useRef, useCallback } from "react";

/**
 * Wraps any card in a cursor-tracking radial glow - the mouse position is
 * written to CSS custom properties (--sx, --sy) which a ::before pseudo
 * element (defined in cc-app.css as .spotlight::before) uses to paint a
 * soft light following the pointer. This is the same interaction pattern
 * used across most premium 2025-era product UIs (Linear, Vercel, Stripe
 * dashboard). No extra dependency - just a mousemove listener writing two
 * numbers.
 *
 * Usage: <SpotlightCard className="tile">...</SpotlightCard>
 * The className you pass keeps all of that class's existing styling
 * (padding, border, etc.) - this only adds the glow layer on top.
 */
export default function SpotlightCard({ as: Tag = "div", className = "", children, ...rest }) {
  const ref = useRef(null);

  const handleMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--sx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--sy", `${e.clientY - rect.top}px`);
  }, []);

  return (
    <Tag
      ref={ref}
      className={`spotlight ${className}`}
      onMouseMove={handleMove}
      {...rest}
    >
      {children}
    </Tag>
  );
}
