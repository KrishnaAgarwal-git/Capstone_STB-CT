import CarbonActivity from "../../models/CarbonActivity.js";
import Transaction from "../../models/Transaction.js";
import { transportFactor } from "../carbonTracking/emissionFactorService.js";
import { gramsToKg } from "../../utils/units.js";
import { TRANSACTION_STATUS, SERVICE_CATEGORIES } from "../../config/constants.js";

/**
 * Data-driven recommendation engine. This is deliberately rule-based, not an
 * LLM call - every suggestion is computed from the user's own logged data
 * against the same emission factor table the calculator uses, so a number
 * quoted here ("switching would save ~4.2kg/week") is reproducible and
 * auditable, not a generated guess.
 */

const LINKED_CATEGORY_KEYS = new Set(
  SERVICE_CATEGORIES.filter((c) => c.linked).map((c) => c.key)
);

export const generateInsights = async (userId) => {
  const since30 = new Date(Date.now() - 30 * 86400000);
  const insights = [];

  const activities = await CarbonActivity.find({
    user: userId, isReversal: false, occurredAt: { $gte: since30 },
  }).lean();

  if (activities.length === 0) {
    return [{
      icon: "🌱",
      title: "Log your first activity to unlock insights",
      body: "Recommendations are computed from your last 30 days of carbon data. The Calculator takes under a minute to log a trip, meal, or electricity reading.",
      stat: null,
    }];
  }

  /* ---- 1. Dominant emission domain ---- */
  const byDomain = {};
  for (const a of activities) {
    byDomain[a.domain] = (byDomain[a.domain] || 0) + a.emissionsGrams;
  }
  const domainEntries = Object.entries(byDomain).sort((a, b) => b[1] - a[1]);
  if (domainEntries.length > 0) {
    const [topDomain, topGrams] = domainEntries[0];
    const totalGrams = Object.values(byDomain).reduce((a, b) => a + b, 0);
    const pct = Math.round((topGrams / totalGrams) * 100);
    const domainLabel = { transportation: "Transport", electricity: "Electricity", food: "Food", consumption: "Consumption" }[topDomain] || topDomain;

    insights.push({
      icon: "📊",
      title: `${domainLabel} is your biggest source of emissions`,
      body: `${domainLabel} accounts for ${pct}% of your logged footprint over the last 30 days. This is the highest-leverage place to make a change.`,
      stat: `${gramsToKg(topGrams)} kg from ${domainLabel.toLowerCase()}`,
    });
  }

  /* ---- 2. Transport mode switch suggestion ---- */
  const transportActivities = activities.filter((a) => a.domain === "transportation");
  const carLike = transportActivities.filter((a) =>
    ["private_car", "auto_rickshaw"].includes(a.subtype)
  );
  if (carLike.length >= 2) {
    const totalKm = carLike.reduce((sum, a) => sum + (a.inputs?.distanceMetres || 0), 0) / 1000;
    const currentFactor = transportFactor("private_car");
    const transitFactor = transportFactor("public_transit");
    const potentialSavingGrams = totalKm * (currentFactor - transitFactor) * 0.5; // model: switch half your trips

    if (potentialSavingGrams > 0) {
      insights.push({
        icon: "🚌",
        title: "Switching half your car trips to transit adds up",
        body: `You logged ${carLike.length} car/auto trips (${totalKm.toFixed(0)} km total) in the last 30 days. Moving half of that distance to public transit, based on the same emission factors your calculator uses, would cut this much:`,
        stat: `${gramsToKg(potentialSavingGrams)} kg / month potential saving`,
      });
    }
  }

  /* ---- 3. Time Bank linkage nudge ---- */
  const recentTxns = await Transaction.find({
    $or: [{ provider: userId }, { receiver: userId }],
    status: TRANSACTION_STATUS.COMPLETED,
    completedAt: { $gte: since30 },
  }).lean();

  const linkedCount = recentTxns.filter((t) => LINKED_CATEGORY_KEYS.has(t.category)).length;
  const unlinkedCount = recentTxns.length - linkedCount;

  if (recentTxns.length === 0) {
    insights.push({
      icon: "⏳",
      title: "You haven't exchanged a service in 30 days",
      body: "Ride-shares, shared errands, remote tutoring, and repairs earn time credits and automatically log a carbon record — two systems updating from one action.",
      stat: null,
    });
  } else if (unlinkedCount > linkedCount) {
    insights.push({
      icon: "🔗",
      title: "Try a carbon-linked service category",
      body: `${linkedCount} of your last ${recentTxns.length} exchanges were carbon-linked (ride-share, shared errand, repair, remote help). Choosing these when you have the option keeps your carbon and time-bank activity moving together.`,
      stat: `${linkedCount}/${recentTxns.length} linked`,
    });
  } else {
    insights.push({
      icon: "✅",
      title: "You're making good use of linked categories",
      body: `${linkedCount} of your last ${recentTxns.length} service exchanges automatically logged a carbon record. Keep it up.`,
      stat: `${linkedCount}/${recentTxns.length} linked`,
    });
  }

  /* ---- 4. Consistency nudge ---- */
  const activeDaySet = new Set(activities.map((a) => new Date(a.occurredAt).toDateString()));
  const activeDays = activeDaySet.size;
  if (activeDays < 8) {
    insights.push({
      icon: "📅",
      title: "Logging a little more often sharpens every other insight",
      body: `You've logged on ${activeDays} of the last 30 days. More frequent logging gives the improvement and consistency leaderboards enough data to reflect your actual habits.`,
      stat: `${activeDays}/30 active days`,
    });
  }

  /* ---- 5. EV region check ---- */
  const evActivities = activities.filter((a) => a.subtype === "electric_vehicle");
  const flaggedEv = evActivities.filter((a) => a.verificationStatus === "flagged");
  if (flaggedEv.length > 0) {
    insights.push({
      icon: "🔋",
      title: "Set your region for accurate EV estimates",
      body: `${flaggedEv.length} of your EV trips used a national-average grid estimate because no region was set on your profile. Setting your actual region gives a more accurate figure.`,
      stat: null,
    });
  }

  return insights.slice(0, 6);
};
