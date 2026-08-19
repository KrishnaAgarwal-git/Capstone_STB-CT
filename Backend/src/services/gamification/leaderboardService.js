import mongoose from "mongoose";
import PointsLedger from "../../models/PointsLedger.js";
import CarbonActivity from "../../models/CarbonActivity.js";
import FriendGroup from "../../models/FriendGroup.js";
import User from "../../models/User.js";
import { gramsToKg } from "../../utils/units.js";

/**
 * THREE PARALLEL LEADERBOARDS - solves the baseline fairness problem.
 *
 *  absolute    -> lowest total footprint (rewards those already low-impact)
 *  improvement -> biggest reduction vs their OWN 30-day baseline
 *                 (rewards someone switching from car to transit)
 *  consistency -> longest streak of logging days (rewards engagement)
 *
 * A single leaderboard would structurally lock out one of these groups.
 */

const memberIds = async (groupId) => {
  const group = await FriendGroup.findById(groupId).select("members status");
  if (!group) return { ids: [], status: "FORMING" };
  return { ids: group.members, status: group.status };
};

export const absoluteBoard = async (groupId) => {
  const { ids } = await memberIds(groupId);
  if (!ids.length) return [];

  const rows = await CarbonActivity.aggregate([
    { $match: { user: { $in: ids }, isReversal: false } },
    {
      $group: {
        _id: "$user",
        totalEmissions: { $sum: "$emissionsGrams" },
        totalSaved: { $sum: "$savedGrams" },
      },
    },
    { $sort: { totalEmissions: 1 } },
  ]);

  const users = await User.find({ _id: { $in: ids } }).select("firstName lastName points badges");
  const map = new Map(users.map((u) => [String(u._id), u]));

  // Members with no activity still appear, at the bottom
  const seen = new Set(rows.map((r) => String(r._id)));
  const tail = ids
    .filter((id) => !seen.has(String(id)))
    .map((id) => ({ _id: id, totalEmissions: 0, totalSaved: 0, noData: true }));

  return [...rows, ...tail].map((r, i) => {
    const u = map.get(String(r._id));
    return {
      rank: i + 1,
      userId: r._id,
      name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
      emissionsKg: gramsToKg(r.totalEmissions),
      savedKg: gramsToKg(r.totalSaved),
      noData: Boolean(r.noData),
    };
  });
};

export const improvementBoard = async (groupId) => {
  const { ids } = await memberIds(groupId);
  if (!ids.length) return [];

  const now = Date.now();
  const d30 = new Date(now - 30 * 86400000);
  const d60 = new Date(now - 60 * 86400000);

  const recent = await CarbonActivity.aggregate([
    { $match: { user: { $in: ids }, isReversal: false, occurredAt: { $gte: d30 } } },
    { $group: { _id: "$user", total: { $sum: "$emissionsGrams" } } },
  ]);
  const baseline = await CarbonActivity.aggregate([
    {
      $match: {
        user: { $in: ids },
        isReversal: false,
        occurredAt: { $gte: d60, $lt: d30 },
      },
    },
    { $group: { _id: "$user", total: { $sum: "$emissionsGrams" } } },
  ]);

  const recentMap = new Map(recent.map((r) => [String(r._id), r.total]));
  const baseMap = new Map(baseline.map((r) => [String(r._id), r.total]));
  const users = await User.find({ _id: { $in: ids } }).select("firstName lastName");
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const rows = ids.map((id) => {
    const key = String(id);
    const base = baseMap.get(key) || 0;
    const curr = recentMap.get(key) || 0;
    const delta = base - curr;
    const pct = base > 0 ? (delta / base) * 100 : 0;
    const u = userMap.get(key);
    return {
      userId: id,
      name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
      baselineKg: gramsToKg(base),
      currentKg: gramsToKg(curr),
      reducedKg: gramsToKg(delta),
      percentChange: Number(pct.toFixed(1)),
      insufficientData: base === 0,
    };
  });

  rows.sort((a, b) => b.percentChange - a.percentChange);
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
};

export const consistencyBoard = async (groupId) => {
  const { ids } = await memberIds(groupId);
  if (!ids.length) return [];

  const since = new Date(Date.now() - 30 * 86400000);
  const rows = await CarbonActivity.aggregate([
    { $match: { user: { $in: ids }, isReversal: false, occurredAt: { $gte: since } } },
    {
      $group: {
        _id: {
          user: "$user",
          day: { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt" } },
        },
      },
    },
    { $group: { _id: "$_id.user", activeDays: { $sum: 1 } } },
    { $sort: { activeDays: -1 } },
  ]);

  const users = await User.find({ _id: { $in: ids } }).select("firstName lastName");
  const map = new Map(users.map((u) => [String(u._id), u]));

  const seen = new Set(rows.map((r) => String(r._id)));
  const tail = ids.filter((id) => !seen.has(String(id))).map((id) => ({ _id: id, activeDays: 0 }));

  return [...rows, ...tail].map((r, i) => {
    const u = map.get(String(r._id));
    return {
      rank: i + 1,
      userId: r._id,
      name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
      activeDays: r.activeDays,
      outOf: 30,
    };
  });
};

/** Points board, excluding ledger entries the collusion guard flagged. */
export const pointsBoard = async (groupId) => {
  const { ids } = await memberIds(groupId);
  if (!ids.length) return [];

  const rows = await PointsLedger.aggregate([
    { $match: { user: { $in: ids }, countsForLeaderboard: true } },
    { $group: { _id: "$user", total: { $sum: "$points" } } },
    { $sort: { total: -1 } },
  ]);

  const users = await User.find({ _id: { $in: ids } }).select("firstName lastName badges");
  const map = new Map(users.map((u) => [String(u._id), u]));

  const seen = new Set(rows.map((r) => String(r._id)));
  const tail = ids.filter((id) => !seen.has(String(id))).map((id) => ({ _id: id, total: 0 }));

  return [...rows, ...tail].map((r, i) => {
    const u = map.get(String(r._id));
    return {
      rank: i + 1,
      userId: r._id,
      name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
      points: r.total,
      badges: u?.badges || [],
    };
  });
};

export const allBoards = async (groupId) => {
  const { status } = await memberIds(groupId);
  // A 2-person ranking is meaningless, so hide boards until the group is ACTIVE
  if (status === "FORMING") {
    return { status, message: "Leaderboards unlock when your group reaches 5 members" };
  }
  const [points, absolute, improvement, consistency] = await Promise.all([
    pointsBoard(groupId),
    absoluteBoard(groupId),
    improvementBoard(groupId),
    consistencyBoard(groupId),
  ]);
  return { status, points, absolute, improvement, consistency };
};
