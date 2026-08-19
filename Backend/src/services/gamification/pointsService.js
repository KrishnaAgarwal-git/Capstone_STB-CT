import PointsLedger from "../../models/PointsLedger.js";
import User from "../../models/User.js";
import { eventBus, EVENTS } from "../../events/eventBus.js";
import { POINTS } from "../../config/constants.js";
import { shouldCountForLeaderboard, isNewCounterparty } from "../timeBanking/collusionGuard.js";
import { gramsToKg } from "../../utils/units.js";

const BADGE_TIERS = [
  { threshold: 0, key: "seedling", label: "Seedling" },
  { threshold: 100, key: "eco_starter", label: "Eco Starter" },
  { threshold: 300, key: "green_warrior", label: "Green Warrior" },
  { threshold: 700, key: "climate_hero", label: "Climate Hero" },
  { threshold: 1500, key: "planet_saver", label: "Planet Saver" },
];

export const badgeForPoints = (points) =>
  [...BADGE_TIERS].reverse().find((b) => points >= b.threshold) || BADGE_TIERS[0];

const award = async ({ userId, groupId, points, reason, refType, refId, counts = true }) => {
  if (!points) return;
  await PointsLedger.create({
    user: userId,
    group: groupId,
    points,
    reason,
    refType,
    refId,
    countsForLeaderboard: counts,
  });
  await User.updateOne({ _id: userId }, { $inc: { points } });

  const user = await User.findById(userId).select("points badges");
  if (user) {
    const badge = badgeForPoints(user.points);
    if (!user.badges.includes(badge.key)) {
      user.badges.push(badge.key);
      await user.save();
    }
  }
};

/** Registers all gamification listeners. Called once at startup. */
export const registerGamificationListeners = () => {
  eventBus.on(EVENTS.TRANSACTION_COMPLETED, async (payload) => {
    try {
      const { providerId, receiverId, groupId, transactionId } = payload;

      // Collusion guard: farming pairs still transact, but stop scoring.
      const providerCounts = await shouldCountForLeaderboard(providerId, receiverId);
      const receiverCounts = await shouldCountForLeaderboard(receiverId, providerId);

      await award({
        userId: providerId,
        groupId,
        points: POINTS.SERVICE_COMPLETED,
        reason: "Service provided",
        refType: "transaction",
        refId: transactionId,
        counts: providerCounts,
      });

      await award({
        userId: receiverId,
        groupId,
        points: Math.round(POINTS.SERVICE_COMPLETED / 2),
        reason: "Service received",
        refType: "transaction",
        refId: transactionId,
        counts: receiverCounts,
      });

      // Diversity bonus - rewards breadth of counterparties, not volume
      if (await isNewCounterparty(providerId, receiverId)) {
        await award({
          userId: providerId,
          groupId,
          points: POINTS.NEW_COUNTERPARTY_BONUS,
          reason: "First exchange with a new group member",
          refType: "transaction",
          refId: transactionId,
        });
      }
    } catch (err) {
      console.error("[gamification] transaction listener failed:", err.message);
    }
  });

  eventBus.on(EVENTS.CARBON_LOGGED, async ({ userId, activityId, savedGrams }) => {
    try {
      const savedKg = gramsToKg(savedGrams || 0);
      const points =
        POINTS.CARBON_LOGGED + Math.round(Math.max(0, savedKg) * POINTS.PER_KG_CO2_SAVED);

      await award({
        userId,
        points,
        reason: "Carbon activity logged",
        refType: "carbon",
        refId: activityId,
      });
    } catch (err) {
      console.error("[gamification] carbon listener failed:", err.message);
    }
  });

  // Clawback when a carbon record is reversed - keeps points honest
  eventBus.on(EVENTS.CARBON_REVERSED, async ({ userId, activityId, savedGrams }) => {
    try {
      const savedKg = gramsToKg(savedGrams || 0);
      const points = -(
        POINTS.CARBON_LOGGED + Math.round(Math.max(0, savedKg) * POINTS.PER_KG_CO2_SAVED)
      );
      await award({
        userId,
        points,
        reason: "Carbon activity reversed - points clawed back",
        refType: "carbon",
        refId: activityId,
      });
    } catch (err) {
      console.error("[gamification] reversal listener failed:", err.message);
    }
  });

  console.log("Gamification listeners registered");
};

export { BADGE_TIERS };
