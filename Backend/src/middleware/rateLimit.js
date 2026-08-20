/**
 * Minimal in-memory rate limiter, keyed by IP. Fine for a single-process
 * capstone deployment; would need a shared store (Redis) behind a load
 * balancer with multiple instances.
 */
const buckets = new Map();

export const createRateLimiter = ({ windowMs, max, message }) => {
  return (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();
    const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    buckets.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ success: false, message: message || "Too many requests" });
    }

    next();
  };
};

// Periodic cleanup so the map doesn't grow unbounded over a long-running process.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets.entries()) {
    if (now > entry.resetAt) buckets.delete(key);
  }
}, 15 * 60 * 1000);
cleanupTimer.unref();
