import {
  FACTOR_DB_VERSION,
  TRANSPORT,
  ELECTRIC_VEHICLE,
  GRID_FACTORS,
  DEFAULT_GRID_REGION,
  FOOD,
  CONSUMPTION,
  REPAIR_AVOIDED,
  AVOIDED_TRIP_BASELINE,
} from "../../data/scientificEmissionFactors.js";

export const getVersion = () => FACTOR_DB_VERSION;

export const transportFactor = (mode) => {
  const entry = TRANSPORT[mode];
  if (!entry) throw new Error(`Unknown transport mode: ${mode}`);
  return entry.gramsPerKm; // grams CO2e per passenger-km
};

export const transportFactorSource = (mode) => TRANSPORT[mode]?.source || null;

export const evEnergyWhPerKm = () => ELECTRIC_VEHICLE.whPerKm;

export const gridFactor = (region) => {
  const entry = GRID_FACTORS[region] || GRID_FACTORS[DEFAULT_GRID_REGION];
  return entry.gramsPerKwh; // grams CO2e per kWh
};

export const gridFactorSource = (region) =>
  (GRID_FACTORS[region] || GRID_FACTORS[DEFAULT_GRID_REGION]).source;

export const isKnownRegion = (region) =>
  Object.prototype.hasOwnProperty.call(GRID_FACTORS, region);

/**
 * grams CO2e per serving = (kg CO2e per kg product) * (serving mass in grams)
 * — the kg->g conversions on each side cancel out, so this is the full
 * calculation, not a shortcut. See SCIENTIFIC_BASIS.md §4 for the derivation
 * written out in full.
 */
export const foodFactorGramsPerServing = (subtype) => {
  const entry = FOOD[subtype];
  if (!entry) throw new Error(`Unknown food type: ${subtype}`);
  return Math.round(entry.perKg.kgCo2ePerKg * entry.servingGrams);
};

export const foodMeta = (subtype) => {
  const entry = FOOD[subtype];
  if (!entry) throw new Error(`Unknown food type: ${subtype}`);
  return {
    label: entry.label,
    servingGrams: entry.servingGrams,
    source: entry.perKg.source,
  };
};

export const consumptionFactor = (subtype) => {
  const entry = CONSUMPTION[subtype];
  if (!entry) throw new Error(`Unknown consumption type: ${subtype}`);
  return entry.grams;
};

export const consumptionFactorSource = (subtype) => CONSUMPTION[subtype]?.source || null;

export const electricityFactor = (region = DEFAULT_GRID_REGION) => gridFactor(region);

export const repairAvoided = (key) => REPAIR_AVOIDED[key]?.grams || 0;

export const avoidedTripBaseline = () => AVOIDED_TRIP_BASELINE;

export const getFactors = () => ({
  version: FACTOR_DB_VERSION,
  transport: TRANSPORT,
  electricVehicle: ELECTRIC_VEHICLE,
  grid: GRID_FACTORS,
  food: FOOD,
  consumption: CONSUMPTION,
});
