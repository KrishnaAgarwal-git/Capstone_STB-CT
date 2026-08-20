import crypto from "crypto";

/**
 * Generates a random token to send in an email link, and a SHA-256 hash of
 * it to store in the database. Only the hash is ever persisted - if the
 * database is ever exposed, the raw tokens (which grant email verification
 * or password reset) are not recoverable from it.
 */
export const generateToken = () => {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
};

export const hashToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

export const TOKEN_EXPIRY_MS = {
  verification: 24 * 60 * 60 * 1000, // 24 hours
  passwordReset: 60 * 60 * 1000, // 1 hour - shorter, since this grants account takeover
};
