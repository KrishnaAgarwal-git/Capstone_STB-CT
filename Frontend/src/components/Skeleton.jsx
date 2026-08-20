/**
 * Skeleton placeholders shaped like the content they precede, using the
 * SAME cc-shimmer keyframe already defined in styles.css for the landing
 * page - so the loading motion feels like the same product, not a
 * generic spinner bolted onto a different page.
 */

export function SkeletonCard() {
  return (
    <div className="skel-card">
      <div className="skel-line skel-line--icon" />
      <div className="skel-line skel-line--label" />
      <div className="skel-line skel-line--value" />
      <div className="skel-line skel-line--sub" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="skel-row">
      <div className="skel-avatar" />
      <div className="skel-row-lines">
        <div className="skel-line skel-line--title" />
        <div className="skel-line skel-line--meta" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 4, Component = SkeletonCard }) {
  return (
    <div className="stats-grid">
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 3 }) {
  return (
    <div className="row-list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
