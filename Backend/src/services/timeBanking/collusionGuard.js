import Transaction from "../../models/Transaction.js";
import {
  PAIR_DOMINANCE_THRESHOLD,
  MAX_PAIR_TXNS_PER_WEEK,
  MAX_HOURS_PER_DAY,
  TRANSACTION_STATUS,
} from "../../config/constants.js";
import { conflict } from "../../utils/ApiError.js";

const WEEK_MS = 7 * 86400000;
const DAY_MS = 86400000;

/** Blocks a pair from transacting more than N times per week. */
export const checkPairVelocity = async (userA, userB) => {
  const since = new Date(Date.now() - WEEK_MS);
  const count = await Transaction.countDocuments({
    createdAt: { $gte: since },
    status: { $ne: TRANSACTION_STATUS.CANCELLED },
    $or: [
      { provider: userA, receiver: userB },
      { provider: userB, receiver: userA },
    ],
  });

  if (count >= MAX_PAIR_TXNS_PER_WEEK) {
    throw conflict(
      `You have already exchanged ${MAX_PAIR_TXNS_PER_WEEK} services with this person this week. Try exchanging with someone else in your group.`
    );
  }
  return true;
};

/** Caps total claimed hours per provider per day. */
export const checkDailyHours = async (providerId, newHours) => {
  const since = new Date(Date.now() - DAY_MS);
  const rows = await Transaction.aggregate([
    {
      $match: {
        provider: providerId,
        createdAt: { $gte: since },
        status: { $ne: TRANSACTION_STATUS.CANCELLED },
      },
    },
    { $group: { _id: null, total: { $sum: "$hours" } } },
  ]);

  const already = rows[0]?.total || 0;
  if (already + newHours > MAX_HOURS_PER_DAY) {
    throw conflict(
      `This would exceed the daily limit of ${MAX_HOURS_PER_DAY} service hours (already logged ${already}h).`
    );
  }
  return true;
};

/**
 * Reciprocity ratio: if one partner accounts for more than half of a user's
 * completed transactions, the exchange still happens (we don't block legitimate
 * use) but it stops earning leaderboard points - which removes the incentive
 * to farm rather than merely detecting it.
 */
export const shouldCountForLeaderboard = async (userId, partnerId) => {
  const total = await Transaction.countDocuments({
    status: TRANSACTION_STATUS.COMPLETED,
    $or: [{ provider: userId }, { receiver: userId }],
  });

  if (total < 4) return true; // too small a sample to judge

  const withPartner = await Transaction.countDocuments({
    status: TRANSACTION_STATUS.COMPLETED,
    $or: [
      { provider: userId, receiver: partnerId },
      { provider: partnerId, receiver: userId },
    ],
  });

  return withPartner / total <= PAIR_DOMINANCE_THRESHOLD;
};

/** True when these two have never completed a transaction before. */
export const isNewCounterparty = async (userId, partnerId) => {
  const prior = await Transaction.countDocuments({
    status: TRANSACTION_STATUS.COMPLETED,
    $or: [
      { provider: userId, receiver: partnerId },
      { provider: partnerId, receiver: userId },
    ],
  });
  return prior === 0;
};
