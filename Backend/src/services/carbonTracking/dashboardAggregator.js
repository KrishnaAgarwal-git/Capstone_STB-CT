import CarbonActivity from "../../models/CarbonActivity.js";
import Transaction from "../../models/Transaction.js";
import User from "../../models/User.js";
import { gramsToKg, creditsToHours } from "../../utils/units.js";
import { CREDITS_PER_HOUR, TRANSACTION_STATUS } from "../../config/constants.js";
import { badgeForPoints } from "../gamification/pointsService.js";

const KG_CO2_PER_TREE_YEAR = 21;

/** Totals + 12-month series, shaped for the dashboard cards. */
export const getSummary = async (userId) => {
  const user = await User.findById(userId).select(
    "firstName lastName email credits points badges region"
  );

  const totals = await CarbonActivity.aggregate([
    { $match: { user: user._id, isReversal: false } },
    {
      $group: {
        _id: null,
        emissions: { $sum: "$emissionsGrams" },
        saved: { $sum: "$savedGrams" },
        count: { $sum: 1 },
      },
    },
  ]);

  const byDomain = await CarbonActivity.aggregate([
    { $match: { user: user._id, isReversal: false } },
    {
      $group: {
        _id: "$domain",
        emissions: { $sum: "$emissionsGrams" },
        saved: { $sum: "$savedGrams" },
      },
    },
  ]);

  // 12 month cumulative series for the spline charts
  const since = new Date();
  since.setMonth(since.getMonth() - 11);
  since.setDate(1);

  const monthly = await CarbonActivity.aggregate([
    { $match: { user: user._id, isReversal: false, occurredAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$occurredAt" } },
        saved: { $sum: "$savedGrams" },
        emissions: { $sum: "$emissionsGrams" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const months = [];
  const cursor = new Date(since);
  for (let i = 0; i < 12; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const row = monthly.find((m) => m._id === key);
    months.push({ month: key, saved: row?.saved || 0, emissions: row?.emissions || 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  let running = 0;
  const cumulativeSavedKg = months.map((m) => {
    running += m.saved;
    return Number(gramsToKg(running));
  });

  const creditsSeries = await monthlyCreditSeries(user._id, since);

  const savedKg = gramsToKg(totals[0]?.saved || 0);
  const emissionsKg = gramsToKg(totals[0]?.emissions || 0);

  const txnCounts = await Transaction.aggregate([
    {
      $match: {
        $or: [{ provider: user._id }, { receiver: user._id }],
        status: TRANSACTION_STATUS.COMPLETED,
      },
    },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);

  return {
    user: {
      id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      region: user.region,
    },
    credits: user.credits,
    hours: creditsToHours(user.credits, CREDITS_PER_HOUR),
    points: user.points,
    badge: badgeForPoints(user.points),
    badges: user.badges,
    savedKg,
    emissionsKg,
    treesEquivalent: Math.floor(savedKg / KG_CO2_PER_TREE_YEAR),
    activityCount: totals[0]?.count || 0,
    completedTransactions: txnCounts[0]?.count || 0,
    byDomain: byDomain.map((d) => ({
      domain: d._id,
      emissionsKg: gramsToKg(d.emissions),
      savedKg: gramsToKg(d.saved),
    })),
    series: {
      months: months.map((m) => m.month),
      cumulativeSavedKg,
      monthlyEmissionsKg: months.map((m) => Number(gramsToKg(m.emissions))),
      monthlyCredits: creditsSeries,
    },
  };
};

const monthlyCreditSeries = async (userId, since) => {
  const rows = await Transaction.aggregate([
    {
      $match: {
        provider: userId,
        status: TRANSACTION_STATUS.COMPLETED,
        completedAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$completedAt" } },
        credits: { $sum: "$credits" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const out = [];
  const cursor = new Date(since);
  let running = 0;
  for (let i = 0; i < 12; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    running += rows.find((r) => r._id === key)?.credits || 0;
    out.push(running);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
};

export const getActivityHistory = async (userId, { limit = 50, domain } = {}) => {
  const q = { user: userId, isReversal: false };
  if (domain) q.domain = domain;

  return CarbonActivity.find(q)
    .populate("sourceTransaction", "category hours credits")
    .sort({ occurredAt: -1 })
    .limit(Number(limit));
};
