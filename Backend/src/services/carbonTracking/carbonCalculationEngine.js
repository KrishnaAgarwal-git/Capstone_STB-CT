import CarbonActivity from "../../models/CarbonActivity.js";
import { transportCalculators } from "./transport.js";
import {
  electricityFactor,
  foodFactor,
  consumptionFactor,
  getVersion,
} from "./emissionFactorService.js";
import { kWhToWh } from "../../utils/units.js";
import { badRequest, conflict } from "../../utils/ApiError.js";
import { eventBus, EVENTS } from "../../events/eventBus.js";
import { TRANSPORT_MODE_KEYS } from "../../config/constants.js";

const MAX_BACKDATE_DAYS = 7;
const DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Validates occurredAt: no future entries, no ancient backdating. */
const validateOccurredAt = (occurredAt) => {
  const when = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(when.getTime())) throw badRequest("Invalid date for occurredAt");
  const now = Date.now();
  if (when.getTime() > now + 60000) throw badRequest("Activity cannot be in the future");
  if (now - when.getTime() > MAX_BACKDATE_DAYS * 86400000)
    throw badRequest(`Activities cannot be backdated more than ${MAX_BACKDATE_DAYS} days`);
  return when;
};

/** Routes a payload to the right domain calculator. Pure - no DB writes. */
export const calculate = ({ domain, subtype, payload = {}, user }) => {
  switch (domain) {
    case "transportation": {
      if (!TRANSPORT_MODE_KEYS.includes(subtype))
        throw badRequest(`Unknown transport mode: ${subtype}`);
      if (!payload.distanceMetres || payload.distanceMetres <= 0)
        throw badRequest("distance is required for transport activities");
      if (payload.distanceMetres > 2_000_000)
        throw badRequest("Distance exceeds plausible daily travel (2000 km)");

      const calc = transportCalculators[subtype];
      return calc({
        mode: subtype,
        distanceMetres: payload.distanceMetres,
        participants: payload.participants,
        qrVerified: payload.qrVerified,
        startTime: payload.startTime,
        endTime: payload.endTime,
        region: payload.region || user?.region,
      });
    }

    case "electricity": {
      const kwh = Number(payload.kwh);
      if (!kwh || kwh <= 0) throw badRequest("kwh is required for electricity activities");
      if (kwh > 200) throw badRequest("Daily electricity above 200 kWh is implausible");
      return {
        emissionsGrams: Math.round(kwh * electricityFactor()),
        savedGrams: 0,
        verificationStatus: "unverified",
        extraInputs: { watthours: kWhToWh(kwh) },
      };
    }

    case "food": {
      const servings = Number(payload.servings) || 1;
      if (servings <= 0 || servings > 20) throw badRequest("servings must be between 1 and 20");
      return {
        emissionsGrams: Math.round(foodFactor(subtype) * servings),
        savedGrams: 0,
        verificationStatus: "unverified",
      };
    }

    case "consumption": {
      const quantity = Number(payload.quantity) || 1;
      if (quantity <= 0 || quantity > 50) throw badRequest("quantity must be between 1 and 50");
      return {
        emissionsGrams: Math.round(consumptionFactor(subtype) * quantity),
        savedGrams: Number(payload.savedGrams) || 0,
        verificationStatus: "unverified",
      };
    }

    default:
      throw badRequest(`Unknown carbon domain: ${domain}`);
  }
};

/**
 * Creates a carbon activity record. Single entry point used by BOTH
 * manual user input and the time-banking linkage registry.
 */
export const createActivity = async ({
  user,
  domain,
  subtype,
  payload = {},
  occurredAt,
  source = "manual",
  sourceTransaction = null,
  session = null,
  precomputed = null,
}) => {
  const when = validateOccurredAt(occurredAt);

  const result = precomputed || calculate({ domain, subtype, payload, user });

  // Duplicate guard: a linked activity that overlaps an existing manual entry
  if (source === "time_bank_linked") {
    const existing = await CarbonActivity.findOne({
      user: user._id,
      domain,
      isReversal: false,
      occurredAt: {
        $gte: new Date(when.getTime() - DUPLICATE_WINDOW_MS),
        $lte: new Date(when.getTime() + DUPLICATE_WINDOW_MS),
      },
      source: "manual",
    });
    if (existing) {
      result.verificationStatus = "flagged";
      result.verificationNote =
        "Possible duplicate of a manual entry logged within 2 hours - review before counting";
    }
  }

  const doc = {
    user: user._id,
    domain,
    subtype,
    emissionsGrams: result.emissionsGrams,
    savedGrams: result.savedGrams || 0,
    inputs: { ...payload, ...(result.extraInputs || {}) },
    emissionFactorVersion: getVersion(),
    distanceSource: payload.distanceSource || (domain === "transportation" ? "manual" : "n/a"),
    source,
    sourceTransaction,
    verificationStatus: result.verificationStatus || "unverified",
    verificationNote: result.verificationNote,
    occurredAt: when,
  };

  let activity;
  try {
    const arr = await CarbonActivity.create(session ? [doc] : [doc], session ? { session } : {});
    activity = arr[0];
  } catch (err) {
    // Unique index on (sourceTransaction, user) - blocks double claiming a shared ride
    if (err.code === 11000) {
      throw conflict("You have already logged a carbon activity for this transaction");
    }
    throw err;
  }

  eventBus.emit(EVENTS.CARBON_LOGGED, {
    userId: user._id,
    activityId: activity._id,
    savedGrams: activity.savedGrams,
    domain,
    source,
  });

  return activity;
};

/**
 * Append-only edit: writes a compensating reversal, then a new record.
 * Never mutates history, so points clawback has a full audit trail.
 */
export const reverseActivity = async ({ user, activityId, reason = "user_edit" }) => {
  const original = await CarbonActivity.findOne({ _id: activityId, user: user._id });
  if (!original) throw badRequest("Activity not found");
  if (original.isReversal) throw badRequest("Cannot reverse a reversal record");
  if (original.reversedBy) throw badRequest("Activity has already been reversed");
  if (original.source === "time_bank_linked")
    throw badRequest(
      "Linked activities cannot be removed directly - void the parent transaction instead"
    );

  const reversal = await CarbonActivity.create({
    user: user._id,
    domain: original.domain,
    subtype: original.subtype,
    emissionsGrams: -original.emissionsGrams,
    savedGrams: -original.savedGrams,
    inputs: { reason },
    isReversal: true,
    reverses: original._id,
    occurredAt: original.occurredAt,
    source: original.source,
  });

  original.reversedBy = reversal._id;
  await original.save();

  eventBus.emit(EVENTS.CARBON_REVERSED, {
    userId: user._id,
    activityId: original._id,
    savedGrams: original.savedGrams,
  });

  return reversal;
};
