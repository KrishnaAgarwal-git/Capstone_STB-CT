import { unauthorized } from "../utils/ApiError.js";

/**
 * Protects service-to-service endpoints (called by the Python recommendation
 * engine, not by a logged-in user's browser) with a shared secret header,
 * rather than requiring a user JWT the calling service doesn't have.
 */
export const requireEngineSecret = (req, res, next) => {
  const expected = process.env.ENGINE_SHARED_SECRET;
  if (!expected) {
    // Not configured - fail closed in production, but allow local dev to
    // proceed with a console warning so the endpoint is still testable.
    if (process.env.NODE_ENV === "production") {
      return next(unauthorized("Engine integration is not configured"));
    }
    console.warn(
      "[engineAuth] ENGINE_SHARED_SECRET is not set - allowing request in development mode only"
    );
    return next();
  }

  const provided = req.headers["x-engine-secret"];
  if (provided !== expected) return next(unauthorized("Invalid engine secret"));
  next();
};
