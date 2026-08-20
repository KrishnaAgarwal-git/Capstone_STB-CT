/**
 * Ride verification codes - the data a real QR code would encode.
 * A driver generates a code and shows it to their rider (as text today;
 * swap generateCode's output into any QR-image library later and nothing
 * else changes). The rider enters it, proving both people were together
 * at trip time - the same trust property QR-based confirmation gives you.
 *
 * In-memory is fine for a capstone demo (single server process). For
 * production this would move to Redis with a TTL.
 */

const codes = new Map(); // code -> { createdBy, distanceMetres, participants, expiresAt }

const TTL_MS = 15 * 60 * 1000; // 15 minutes - a ride should be confirmed quickly

const randomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

export const generateCode = ({ userId, distanceMetres, participants }) => {
  let code;
  do {
    code = randomCode();
  } while (codes.has(code));

  codes.set(code, {
    createdBy: String(userId),
    distanceMetres,
    participants,
    expiresAt: Date.now() + TTL_MS,
  });

  return code;
};

export const verifyCode = ({ code, verifierId }) => {
  const entry = codes.get(code?.toUpperCase());
  if (!entry) return { ok: false, reason: "Code not found or already used" };
  if (Date.now() > entry.expiresAt) {
    codes.delete(code.toUpperCase());
    return { ok: false, reason: "Code has expired" };
  }
  if (entry.createdBy === String(verifierId)) {
    return { ok: false, reason: "You cannot verify your own code" };
  }

  codes.delete(code.toUpperCase()); // single use
  return { ok: true, distanceMetres: entry.distanceMetres, participants: entry.participants };
};

// Periodic cleanup so the Map doesn't grow unbounded over a long-running process
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codes.entries()) {
    if (now > entry.expiresAt) codes.delete(code);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref(); // don't keep the Node process alive just for this
