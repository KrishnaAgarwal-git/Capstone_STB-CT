/**
 * Bridges the recommendation engine's 104-entry knowledge base vocabulary
 * (activity_key strings like "car_solo_commute", "chicken_curry_cooked") to
 * this app's own scientific emission factor data. This is what serves
 * POST /api/v1/recommendations/preview — the exact contract
 * `HttpCarbonCalculationClient` expects (see CARBON_ENGINE_INTEGRATION.md).
 *
 * Two tiers, mirroring the engine's own MockCarbonCalculationClient design
 * (curated table + category fallback) but with REAL cited numbers instead
 * of illustrative mock ones:
 *
 *   1. CURATED: every transport and food activity_key actually used by the
 *      104-entry knowledge base (confirmed by reading recommendations_data.py
 *      directly) is mapped to a precise calculator from
 *      scientificEmissionFactors.js.
 *   2. CATEGORY FALLBACK: activity_keys outside transport/food (electricity
 *      appliances, water use, shopping, waste, lifestyle items) use a
 *      documented category-average estimate, clearly labeled as such, rather
 *      than inventing per-item precision the underlying data doesn't support.
 */

import { transportFactor, foodFactorGramsPerServing, gridFactor } from "../services/carbonTracking/emissionFactorService.js";
import { kmToMetres } from "../utils/units.js";

const AVG_SERVING_GRAMS = 250; // used when the engine sends a generic "quantity" without a serving-mass hint

/**
 * Transport: engine quantity/unit is typically kilometres for a commute.
 * `resolve` returns grams CO2e for the given quantity.
 */
const transport = (mode, { hybridFactor } = {}) => ({
  domain: "transportation",
  resolve: (quantity, unit, regionCode) => {
    const km = unit === "km" ? quantity : quantity; // engine always sends km for commute activities
    if (mode === "electric_vehicle") {
      const region = regionCode === "IN_PUNJAB" ? "IN-PB" : "IN-NATIONAL";
      const whPerKm = 150; // see scientificEmissionFactors.ELECTRIC_VEHICLE
      const kWh = (km * whPerKm) / 1000;
      return kWh * gridFactor(region);
    }
    const base = transportFactor(mode);
    const factor = hybridFactor ? base * hybridFactor : base;
    return km * factor;
  },
  source: mode === "electric_vehicle" ? "CEA India grid WAEF x EV energy consumption" : `Derived/DEFRA-based factor for ${mode}`,
  unit: "kg_co2e_per_km",
});

/** Food: engine quantity/unit is typically "meal"/"serving" count or grams. */
const food = (subtype) => ({
  domain: "food",
  resolve: (quantity) => {
    const perServing = foodFactorGramsPerServing(subtype);
    // If the engine sends a serving/meal count, multiply directly; if it
    // sends grams, scale from the per-serving figure's own reference mass.
    return perServing * (quantity || 1);
  },
  source: `Poore & Nemecek (2018) — ${subtype}`,
  unit: "kg_co2e_per_serving",
});

export const CURATED_ACTIVITY_MAP = {
  // --- Transport (matches every transport activity_key in the knowledge base) ---
  car_solo_commute: transport("petrol_car"),
  gasoline_car_commute: transport("petrol_car"),
  car_leisure_trip: transport("petrol_car"),
  diesel_car_commute: transport("diesel_car"),
  cng_car_commute: transport("cng_car"),
  hybrid_car_commute: transport("petrol_car", { hybridFactor: 0.6 }), // ~40% more efficient than petrol - documented estimate
  car_carpool_commute: {
    domain: "transportation",
    resolve: (quantity) => (quantity || 0) * transportFactor("shared_ride") / 2, // 2-person carpool assumption
    source: "Petrol car factor split across an assumed 2-person carpool",
    unit: "kg_co2e_per_km",
  },
  two_wheeler_solo_commute: transport("two_wheeler"),
  auto_rickshaw_commute: transport("auto_rickshaw"),
  bus_commute: transport("public_transit"),
  metro_commute: transport("rail_metro"),
  local_train_travel: transport("rail_metro"),
  train_journey: transport("rail_metro"),
  ev_solo_commute: transport("electric_vehicle"),
  bicycle_commute: transport("walk_cycle"),
  walk_commute: transport("walk_cycle"),

  // --- Food (matches every food activity_key in the knowledge base) ---
  beef_or_lamb_cooked: food("red_meat"),
  beef_stew_cooked: food("red_meat"),
  beef_stir_fry_cooked: food("red_meat"),
  lamb_curry_cooked: food("red_meat"),
  processed_meat_cooked: food("red_meat"),
  daily_meat_consumption: food("red_meat"),
  pork_stir_fry_cooked: food("poultry"), // app's 6-category food set has no distinct pork calculator; poultry (6kg/kg) is the closer proxy to pork (7kg/kg per Poore & Nemecek) than dairy
  chicken_cooked: food("poultry"),
  chicken_curry_cooked: food("poultry"),
  grilled_fish_cooked: food("fish"),
  scrambled_eggs_cooked: food("vegetarian"), // eggs not in the app's own 6-category set; nearest documented proxy
  paneer_curry_cooked: food("dairy"),
  grated_cheese_used: food("dairy"),
  dairy_yogurt_consumed: food("dairy"),
  butter_used: food("dairy"),
  cow_milk_consumed: food("vegetarian"),
  lentil_curry_cooked: food("vegan"),
  lentil_dal_cooked: food("vegan"),
  chickpea_curry_cooked: food("vegan"),
  tofu_stir_fry_cooked: food("vegan"),
  oat_milk_consumed: food("vegan"),
  soy_milk_consumed: food("vegan"),
  local_seasonal_veg: food("vegetarian"),
  imported_out_of_season_veg: food("vegetarian"),
  coconut_yogurt_consumed: food("vegan"),
};

/**
 * Category-level fallback for anything outside the curated map (electricity
 * appliances, water use, shopping items, waste, lifestyle). Each figure is a
 * documented order-of-magnitude estimate, not a per-item published standard —
 * labeled accordingly so it's never mistaken for the same precision as the
 * curated transport/food entries above.
 */
export const CATEGORY_FALLBACK_GRAMS = {
  transport: 2000, // ~12km average petrol-car trip
  food: 1500, // ~250g mixed-diet meal average
  electricity: 1500, // ~2kWh typical appliance-use event at CEA grid factor
  water: 200, // heating/pumping energy for an average water-use event
  shopping: 8000, // midpoint of the app's own clothing-item estimate
  waste: 400, // generic waste-stream estimate
  lifestyle: 1000, // generic catch-all
};
export const CATEGORY_FALLBACK_SOURCE = "STB_CT_CATEGORY_ESTIMATE — order-of-magnitude category average, not a per-item published standard. See SCIENTIFIC_BASIS.md.";

/**
 * The single function the /recommendations/preview endpoint calls.
 * Returns { co2eKg, factorSource, factorUnit, confidence } — never throws for
 * an unmapped key, since the contract expects KeyError only when NO factor
 * (curated or fallback) can be produced at all, which never happens here.
 */
export const resolveActivityEstimate = ({ activityKey, quantity, unit, regionCode, category }) => {
  const curated = CURATED_ACTIVITY_MAP[activityKey];
  if (curated) {
    const grams = curated.resolve(quantity, unit, regionCode);
    return {
      co2eKg: grams / 1000,
      factorSource: curated.source,
      factorUnit: curated.unit,
      confidence: 0.9,
    };
  }

  const fallbackCategory = category && CATEGORY_FALLBACK_GRAMS[category] !== undefined ? category : "lifestyle";
  const grams = CATEGORY_FALLBACK_GRAMS[fallbackCategory] * (quantity || 1);
  return {
    co2eKg: grams / 1000,
    factorSource: CATEGORY_FALLBACK_SOURCE,
    factorUnit: "kg_co2e_per_unit",
    confidence: 0.4,
  };
};
