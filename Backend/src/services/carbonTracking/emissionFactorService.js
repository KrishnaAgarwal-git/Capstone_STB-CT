import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const factorsPath = path.join(__dirname, "../../data/emissionFactors.json");

const factors = JSON.parse(readFileSync(factorsPath, "utf-8"));

export const getFactors = () => factors;
export const getVersion = () => factors.version;

export const transportFactor = (mode) => {
  const f = factors.transport[mode];
  if (f === undefined) throw new Error(`Unknown transport mode: ${mode}`);
  return f; // grams CO2e per passenger-km
};

export const gridFactor = (region) => {
  return factors.gridMixByRegion[region] ?? factors.gridMixByRegion["IN-NATIONAL"];
};

export const isKnownRegion = (region) =>
  Object.prototype.hasOwnProperty.call(factors.gridMixByRegion, region);

export const foodFactor = (subtype) => {
  const f = factors.food[subtype];
  if (f === undefined) throw new Error(`Unknown food type: ${subtype}`);
  return f;
};

export const consumptionFactor = (subtype) => {
  const f = factors.consumption[subtype];
  if (f === undefined) throw new Error(`Unknown consumption type: ${subtype}`);
  return f;
};

export const electricityFactor = () => factors.electricity.grid_electricity;

export const repairAvoided = (key) => factors.repairAvoidedEmissions[key] ?? 0;

export const avoidedTripBaseline = () => factors.baselines;
