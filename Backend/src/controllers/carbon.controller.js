import {
  createActivity,
  reverseActivity,
} from "../services/carbonTracking/carbonCalculationEngine.js";
import { getSummary, getActivityHistory } from "../services/carbonTracking/dashboardAggregator.js";
import { generateCode, verifyCode } from "../services/carbonTracking/rideCodeService.js";
import { asyncHandler, ok, created, badRequest } from "../utils/ApiError.js";
import { kmToMetres, haversineMetres, ROAD_CIRCUITY_FACTOR } from "../utils/units.js";

/**
 * Distance resolution with a three-tier fallback:
 *   explicit km -> haversine from coordinates -> error.
 * The method used is recorded so accuracy stays auditable.
 */
const resolveDistance = (payload) => {
  if (payload.distanceKm) {
    return { distanceMetres: kmToMetres(payload.distanceKm), distanceSource: "manual" };
  }
  if (payload.from && payload.to) {
    const straight = haversineMetres(payload.from, payload.to);
    return {
      distanceMetres: Math.round(straight * ROAD_CIRCUITY_FACTOR),
      distanceSource: "haversine",
    };
  }
  return { distanceMetres: 0, distanceSource: "n/a" };
};

export const logActivity = asyncHandler(async (req, res) => {
  const { domain, subtype, occurredAt, ...rest } = req.body;
  if (!domain || !subtype) throw badRequest("domain and subtype are required");

  let payload = { ...rest };

  if (domain === "transportation") {
    const { distanceMetres, distanceSource } = resolveDistance(rest);
    if (!distanceMetres) throw badRequest("Provide distanceKm, or from/to coordinates");
    payload = { ...payload, distanceMetres, distanceSource, region: req.user.region };
  }

  const activity = await createActivity({
    user: req.user,
    domain,
    subtype,
    payload,
    occurredAt,
    source: "manual",
  });

  created(res, activity, "Activity logged");
});

export const summary = asyncHandler(async (req, res) => {
  ok(res, await getSummary(req.user._id));
});

export const history = asyncHandler(async (req, res) => {
  ok(res, await getActivityHistory(req.user._id, req.query));
});

export const reverse = asyncHandler(async (req, res) => {
  const rev = await reverseActivity({
    user: req.user,
    activityId: req.params.id,
    reason: req.body.reason,
  });
  ok(res, rev, "Activity reversed - a compensating record was written and points adjusted");
});

/**
 * Driver generates a code (the payload a real QR image would encode).
 * Show this to the rider - in a full deployment, render it as a QR image
 * instead of text and nothing else in this flow changes.
 */
export const rideCodeGenerate = asyncHandler(async (req, res) => {
  const { distanceKm, participants } = req.body;
  if (!distanceKm) throw badRequest("distanceKm is required");

  const code = generateCode({
    userId: req.user._id,
    distanceMetres: kmToMetres(distanceKm),
    participants: Number(participants) || 2,
  });

  created(res, { code, expiresInMinutes: 15 }, "Show this code to your ride partner");
});

/** Rider enters the driver's code, then logs their own linked carbon activity. */
export const rideCodeVerify = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw badRequest("code is required");

  const result = verifyCode({ code, verifierId: req.user._id });
  if (!result.ok) throw badRequest(result.reason);

  const activity = await createActivity({
    user: req.user,
    domain: "transportation",
    subtype: "shared_ride",
    payload: {
      distanceMetres: result.distanceMetres,
      participants: result.participants,
      qrVerified: true,
    },
    source: "manual",
  });

  created(res, activity, "Code verified - shared ride logged for both of you");
});
