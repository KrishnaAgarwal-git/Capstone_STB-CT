import CarbonActivity from "../../models/CarbonActivity.js";
import { generateInsights } from "./recommendationEngine.js";
import { badRequest, notFound } from "../../utils/ApiError.js";

const ENGINE_URL = (process.env.RECOMMENDATION_ENGINE_URL || "http://localhost:8421").replace(/\/$/, "");
const ENGINE_TIMEOUT_MS = 4000;

/** Maps this app's stored domain/subtype vocabulary onto the shape the Python engine expects. */
const toEngineActivity = (a) => ({
  category: a.domain, // "transportation" | "electricity" | "food" | "consumption"
  subtype: a.subtype,
  quantity: a.domain === "transportation" ? (a.inputs?.distanceMetres || 0) / 1000 : Number(a.inputs?.servings || a.inputs?.quantity || a.inputs?.kwh || 1),
  unit: a.domain === "transportation" ? "km" : a.domain === "electricity" ? "kwh" : "unit",
  occurred_at: new Date(a.occurredAt).toISOString(),
});

/** Best-effort mapping of this app's own activity_key vocabulary onto the
 * knowledge base's naming, so the engine's candidate matching has a fighting
 * chance of recognising what a user actually logged. Not exhaustive - see
 * Backend/src/data/activityKeyMapping.js for the reverse (engine -> here) map. */
const SUBTYPE_TO_ENGINE_KEY = {
  petrol_car: "car_solo_commute",
  diesel_car: "diesel_car_commute",
  cng_car: "cng_car_commute",
  two_wheeler: "two_wheeler_solo_commute",
  auto_rickshaw: "auto_rickshaw_commute",
  public_transit: "bus_commute",
  rail_metro: "metro_commute",
  shared_ride: "car_carpool_commute",
  electric_vehicle: "ev_solo_commute",
  walk_cycle: "walk_commute",
  red_meat: "beef_or_lamb_cooked",
  dairy: "grated_cheese_used",
  poultry: "chicken_curry_cooked",
  fish: "grilled_fish_cooked",
  vegetarian: "local_seasonal_veg",
  vegan: "lentil_curry_cooked",
};

const withEngineKey = (a) => ({
  ...toEngineActivity(a),
  subtype: SUBTYPE_TO_ENGINE_KEY[a.subtype] || a.subtype,
});

const regionCodeFor = (region) => (region === "IN-PB" ? "IN_PUNJAB" : "GLOBAL");

/** Calls the Python engine with a timeout, so a down/slow engine never hangs the request. */
const callEngine = async (path, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { res, data: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Primary path: real user activity -> Python LinUCB recommendation engine.
 * Fallback path: the Node rule-based engine (recommendationEngine.js), used
 * only when the Python service is unreachable, so the feature never goes
 * fully dark just because a second process isn't running.
 *
 * Every field the engine computes is passed through to the frontend
 * (recommendationId, percentReduction, tradeoffNote, weeklyKgProjection,
 * monthlyKgProjection) - previously only a subset reached the UI, which
 * meant the engine was doing richer work than anyone could see or act on.
 */
export const getRecommendations = async (user) => {
  const since30 = new Date(Date.now() - 30 * 86400000);
  const activities = await CarbonActivity.find({
    user: user._id, isReversal: false, occurredAt: { $gte: since30 },
  }).lean();

  const accountAgeDays = Math.floor((Date.now() - new Date(user.createdAt || Date.now())) / 86400000);

  try {
    const { res, data: engineResult } = await callEngine("/recommendations", {
      user_id: String(user._id),
      account_age_days: accountAgeDays,
      region_code: regionCodeFor(user.region),
      activities: activities.map(withEngineKey),
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status}`);

    return {
      source: "linucb_engine",
      engineOnline: true,
      profile: engineResult.profile,
      insights: (engineResult.recommendations || []).map((r) => ({
        // Kept for feedback submission - NOT shown raw in the UI, but the
        // frontend needs this to call the feedback endpoint below.
        recommendationId: r.recommendationId,
        icon: iconForCategory(r.category),
        title: r.title,
        body: r.body,
        stat: r.savedKgCo2e ? `${r.savedKgCo2e} kg CO2e/week potential saving` : null,
        difficulty: r.difficulty,
        confidence: r.confidence,
        // Previously computed by the engine but dropped here - now passed through.
        percentReduction: r.percentReduction,
        tradeoffNote: r.tradeoffNote,
        weeklyKgProjection: r.weeklyKgProjection,
        monthlyKgProjection: r.monthlyKgProjection,
      })),
    };
  } catch (err) {
    // Engine not running / unreachable - fall back to the rule-based engine
    // rather than showing nothing. This is stated explicitly to the frontend
    // via `source`, not silently swapped.
    const fallback = await generateInsights(user._id);
    return {
      source: "rule_based_fallback",
      engineOnline: false,
      engineError: err.message,
      insights: fallback,
    };
  }
};

const VALID_EVENT_TYPES = new Set([
  "accepted", "dismissed", "ignored", "partially_completed",
  "behaviour_confirmed", "behaviour_unchanged",
]);

/**
 * Closes the feedback loop: tells the SAME stateful engine process that
 * generated a recommendation whether the user accepted or dismissed it.
 * That updates a LinUCB arm weight and the user's UserContext in the
 * engine's memory, which measurably changes what the NEXT
 * getRecommendations() call returns for this user - this is real learning,
 * not a logged-and-ignored event.
 *
 * Requires the rule-based fallback engine to be bypassed here deliberately:
 * feedback only makes sense against a real engine-generated recommendation
 * id, which the fallback engine doesn't produce.
 */
export const sendRecommendationFeedback = async (user, recommendationId, eventType) => {
  if (!recommendationId) throw badRequest("recommendationId is required");
  if (!VALID_EVENT_TYPES.has(eventType)) {
    throw badRequest(`eventType must be one of: ${[...VALID_EVENT_TYPES].join(", ")}`);
  }

  let res, data;
  try {
    ({ res, data } = await callEngine("/recommendations/feedback", {
      user_id: String(user._id),
      notification_id: recommendationId,
      event_type: eventType,
    }));
  } catch (err) {
    throw badRequest(
      "Could not reach the AI recommendation engine to record this feedback. " +
      "It may be offline - start engine/engine_server.py and try again."
    );
  }

  if (res.status === 404) {
    throw notFound(
      data.error || "That recommendation is no longer recognised - refresh your insights and try again."
    );
  }
  if (!res.ok) {
    throw badRequest(data.error || `Engine responded ${res.status}`);
  }

  return data;
};

const CATEGORY_ICONS = {
  transport: "🚌", food: "🍽️", electricity: "⚡",
  shopping: "📦", water: "💧", waste: "🗑️", lifestyle: "🌱",
};
const iconForCategory = (cat) => CATEGORY_ICONS[cat] || "✨";
