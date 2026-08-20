/**
 * SCIENTIFIC EMISSION FACTOR DATABASE
 * ====================================
 * Every factor below carries a source, a publication/version, and — where the
 * figure is derived rather than directly published — the calculation shown
 * so it is auditable, not asserted. See ../../../SCIENTIFIC_BASIS.md for the
 * full methodology write-up (suitable for a report appendix).
 *
 * Primary standards used:
 *   - GHG Protocol (WRI/WBCSD) — overall accounting framework, Scope 1/2/3 boundaries
 *   - IPCC 2006 Guidelines for National GHG Inventories (Vol. 2, Energy) — default
 *     fuel combustion factors (e.g. petrol, CNG)
 *   - UK DEFRA/DESNZ 2024 Government GHG Conversion Factors for Company Reporting —
 *     internationally the most widely used, publicly documented transport factor set
 *   - CEA (Central Electricity Authority, Government of India) CO2 Baseline Database,
 *     Version 21.0 (2025) — the official Indian grid emission factor, used for the
 *     National Electricity Committee's Scope 2 reporting and India's carbon market (CCTS)
 *   - Poore, J., & Nemecek, T. (2018). "Reducing food's environmental impacts through
 *     producers and consumers." Science, 360(6392), 987–992 — the largest meta-analysis
 *     of global food-system LCA data (1,530 studies screened, 570 included), the source
 *     GHG Protocol's own food-sector guidance and most food-carbon calculators draw on.
 *
 * Units are grams CO2e, converted at the point of use to the app's canonical
 * storage units (grams for mass, metres for distance, watt-hours for energy).
 */

export const FACTOR_DB_VERSION = "scientific-v1-2026";

/* ------------------------------------------------------------------ */
/* 1. TRANSPORT — grams CO2e per passenger-kilometre (unless noted)   */
/* ------------------------------------------------------------------ */
/**
 * Two conversion constants used repeatedly below, both IPCC 2006 Guidelines
 * Vol. 2 Table 1.4 default combustion factors (also used by DEFRA):
 *   - Motor gasoline (petrol): 2.31 kg CO2 per litre burned
 *   - CNG: 2.68 kg CO2 per kg burned (India's dominant auto-rickshaw fuel)
 */
const KG_CO2_PER_LITRE_PETROL = 2.31;
const KG_CO2_PER_KG_CNG = 2.68;

export const TRANSPORT = {
  // DEFRA 2024 Government GHG Conversion Factors — average petrol car, all sizes
  petrol_car: {
    gramsPerKm: 170,
    source: "UK DEFRA/DESNZ 2024 GHG Conversion Factors — average petrol car",
  },
  // DEFRA 2024 — average diesel car, all sizes
  diesel_car: {
    gramsPerKm: 168,
    source: "UK DEFRA/DESNZ 2024 GHG Conversion Factors — average diesel car",
  },
  // No single official CNG-car passenger factor is published by DEFRA (CNG cars
  // are not common in the UK fleet). Derived from the IPCC default CNG combustion
  // factor and a typical India CNG passenger car fuel economy of ~20 km/kg CNG,
  // which is representative of common India CNG hatchbacks/sedans.
  cng_car: {
    gramsPerKm: Math.round((KG_CO2_PER_KG_CNG * 1000) / 20),
    source: "Derived: IPCC 2006 default CNG combustion factor (2.68 kgCO2/kg) ÷ 20 km/kg (typical India CNG car fuel economy)",
  },
  // No official passenger factor exists for Indian two-wheelers either. Derived
  // from the same IPCC petrol combustion factor and a representative India
  // two-wheeler fuel economy of ~45 km/litre (commuter scooters/motorcycles).
  two_wheeler: {
    gramsPerKm: Math.round((KG_CO2_PER_LITRE_PETROL * 1000) / 45),
    source: "Derived: IPCC 2006 default petrol combustion factor (2.31 kgCO2/L) ÷ 45 km/L (typical India two-wheeler fuel economy)",
  },
  // Auto-rickshaws run on CNG in most Indian cities. Vehicle-km factor derived
  // as above (~28 km/kg CNG typical), then divided by a typical occupancy of
  // 1.5 passengers to get a passenger-km figure, since rickshaws are usually
  // shared or run with 1-2 riders.
  auto_rickshaw: {
    gramsPerKm: Math.round(((KG_CO2_PER_KG_CNG * 1000) / 28) / 1.5),
    source: "Derived: IPCC 2006 CNG combustion factor ÷ 28 km/kg (typical auto-rickshaw fuel economy) ÷ 1.5 (typical occupancy)",
  },
  // DEFRA 2024 average local bus factor, used as the closest publicly documented
  // reference point. India bus occupancy tends to run higher than the UK average
  // this factor is based on, which would lower the true India per-passenger
  // figure — flagged here rather than adjusted, since no official India bus
  // passenger-km factor is published.
  public_transit: {
    gramsPerKm: 96,
    source: "UK DEFRA/DESNZ 2024 GHG Conversion Factors — average local bus (used as documented proxy; see caveat in SCIENTIFIC_BASIS.md)",
  },
  // DEFRA 2024 National Rail factor — used for any rail/metro trip.
  rail_metro: {
    gramsPerKm: 35.46,
    source: "UK DEFRA/DESNZ 2024 GHG Conversion Factors — National Rail, 0.03546 kgCO2e/pkm",
  },
  // Shared rides use the private petrol_car vehicle-km factor, then the engine
  // divides by actual participant count at calculation time (see transport.js).
  shared_ride: {
    gramsPerKm: 170,
    source: "Same basis as petrol_car — split across participants at calculation time",
  },
  walk_cycle: {
    gramsPerKm: 0,
    source: "No combustion — zero direct emissions",
  },
  // EV emissions are NOT a fixed factor — they depend on the electricity grid
  // mix, computed dynamically. See ELECTRIC_VEHICLE below.
};

/**
 * Electric vehicle energy consumption assumption and the calculation rule.
 * EV emissions are never a static factor — always energy-consumed × grid factor,
 * so the number moves correctly with region.
 */
export const ELECTRIC_VEHICLE = {
  whPerKm: 150, // representative India EV energy consumption (e.g. compact EVs, ~15 kWh/100km)
  source: "Representative India EV energy consumption, ~15 kWh/100km (compact EV segment)",
  note: "gCO2e/km = (whPerKm / 1000) × grid factor for the user's region. Never treated as zero.",
};

/* ------------------------------------------------------------------ */
/* 2. ELECTRICITY GRID — grams CO2e per kWh                            */
/* ------------------------------------------------------------------ */
export const GRID_FACTORS = {
  // Official Indian national grid emission factor. CEA publishes three
  // variants (WAEF, Operating Margin, Build Margin); WAEF is the correct
  // choice for consumption-side (Scope 2) accounting, which is what an
  // individual logging their own electricity use needs.
  "IN-NATIONAL": {
    gramsPerKwh: 710,
    source: "CEA (Central Electricity Authority, Govt. of India) CO2 Baseline Database, Version 21.0 — Weighted Average Emission Factor, FY 2024-25",
  },
  // State-level grids are not separately published by CEA (India's grid is
  // largely unified/interconnected since the "one nation, one grid" reform),
  // so all Indian regions in this app currently map to the national WAEF.
  // This is flagged explicitly rather than inventing state-specific numbers.
  // India operates a unified, interconnected national grid ("One Nation, One
  // Grid"), and CEA does not publish separate state-level CONSUMPTION-side
  // factors. Every state/UT below therefore maps to the same national WAEF -
  // this is the scientifically correct treatment, not a shortcut. The list is
  // complete (all 28 states + 8 UTs) so no user is ever forced to pick a
  // neighbouring state that isn't theirs.
  "IN-AN": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Andaman & Nicobar
  "IN-AP": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Andhra Pradesh
  "IN-AR": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Arunachal Pradesh
  "IN-AS": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Assam
  "IN-BR": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Bihar
  "IN-CH": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Chandigarh
  "IN-CT": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Chhattisgarh
  "IN-DH": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Dadra & Nagar Haveli and Daman & Diu
  "IN-DL": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Delhi
  "IN-GA": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Goa
  "IN-GJ": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Gujarat
  "IN-HR": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Haryana
  "IN-HP": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Himachal Pradesh
  "IN-JK": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Jammu & Kashmir
  "IN-JH": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Jharkhand
  "IN-KA": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Karnataka
  "IN-KL": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Kerala
  "IN-LA": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Ladakh
  "IN-LD": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Lakshadweep
  "IN-MP": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Madhya Pradesh
  "IN-MH": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Maharashtra
  "IN-MN": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Manipur
  "IN-ML": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Meghalaya
  "IN-MZ": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Mizoram
  "IN-NL": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Nagaland
  "IN-OR": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Odisha
  "IN-PY": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Puducherry
  "IN-PB": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF — no separately published Punjab-specific grid factor exists (unified national grid)" },
  "IN-RJ": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Rajasthan
  "IN-SK": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Sikkim
  "IN-TN": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Tamil Nadu
  "IN-TG": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Telangana
  "IN-TR": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Tripura
  "IN-UP": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Uttar Pradesh
  "IN-UT": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // Uttarakhand
  "IN-WB": { gramsPerKwh: 710, source: "Mapped to CEA national WAEF" }, // West Bengal
};
export const DEFAULT_GRID_REGION = "IN-NATIONAL";

/* ------------------------------------------------------------------ */
/* 3. FOOD — grams CO2e per serving                                    */
/* ------------------------------------------------------------------ */
/**
 * Base figures are Poore & Nemecek (2018) global-average kg CO2e per kg of
 * product (as reported and widely republished by Our World in Data, the
 * standard secondary source for this dataset). Each category also defines a
 * reference serving mass so the per-serving figure shown in the app is a
 * transparent, documented calculation — not an unsourced "per serving" number.
 */
const FOOD_PER_KG = {
  beef: { kgCo2ePerKg: 60, source: "Poore & Nemecek (2018), Science 360(6392) — beef, global average" },
  lamb: { kgCo2ePerKg: 24, source: "Poore & Nemecek (2018) — lamb/mutton, global average" },
  pork: { kgCo2ePerKg: 7, source: "Poore & Nemecek (2018) — pig meat, global average" },
  cheese: { kgCo2ePerKg: 21, source: "Poore & Nemecek (2018) — cheese, global average" },
  poultry: { kgCo2ePerKg: 6, source: "Poore & Nemecek (2018) — poultry meat, global average" },
  fish_farmed: { kgCo2ePerKg: 5, source: "Poore & Nemecek (2018) — farmed fish, global average" },
  eggs: { kgCo2ePerKg: 4.5, source: "Poore & Nemecek (2018) — eggs, global average" },
  milk: { kgCo2ePerKg: 3, source: "Poore & Nemecek (2018) — cow's milk (FPCM basis), global average" },
  plant_milk: { kgCo2ePerKg: 0.9, source: "Poore & Nemecek (2018) — oat/soy milk, global average" },
  mixed_vegetables: { kgCo2ePerKg: 2, source: "Poore & Nemecek (2018) — vegetable products, global average" },
  legumes_grains: { kgCo2ePerKg: 1, source: "Poore & Nemecek (2018) — peas/pulses, global average" },
};

export const FOOD = {
  red_meat: { perKg: FOOD_PER_KG.beef, servingGrams: 200, label: "Red meat (e.g. beef)" },
  dairy: { perKg: FOOD_PER_KG.cheese, servingGrams: 100, label: "Dairy-heavy (e.g. cheese)" },
  poultry: { perKg: FOOD_PER_KG.poultry, servingGrams: 200, label: "Poultry" },
  fish: { perKg: FOOD_PER_KG.fish_farmed, servingGrams: 200, label: "Fish" },
  vegetarian: { perKg: FOOD_PER_KG.mixed_vegetables, servingGrams: 350, label: "Vegetarian meal" },
  vegan: { perKg: FOOD_PER_KG.legumes_grains, servingGrams: 350, label: "Vegan meal" },
};

/* ------------------------------------------------------------------ */
/* 4. CONSUMPTION / GOODS — grams CO2e per item                        */
/* ------------------------------------------------------------------ */
/**
 * No single official standard publishes per-item factors the way DEFRA does
 * for transport — these are labeled "indicative" and drawn from published
 * LCA-aggregate ranges, using the midpoint of each cited range.
 */
export const CONSUMPTION = {
  clothing_item: {
    grams: 10000,
    source: "Indicative — midpoint of published cotton-garment lifecycle LCA aggregates (WRAP / Ellen MacArthur Foundation ranges, ~8-12 kgCO2e/garment)",
  },
  electronics_small: {
    grams: 55000,
    source: "Indicative — manufacturing-phase footprint aggregated from manufacturer environmental/LCA reports for small electronics (e.g. smartphones), ~50-60 kgCO2e",
  },
  electronics_large: {
    grams: 200000,
    source: "Indicative — manufacturing-phase footprint aggregated from manufacturer LCA reports for laptops/large electronics, ~180-220 kgCO2e",
  },
  household_goods: {
    grams: 15000,
    source: "Indicative — general durable-goods LCA aggregate midpoint",
  },
  packaging_waste: {
    grams: 500,
    source: "Indicative — generic mixed packaging (plastic/cardboard) waste-stream LCA estimate, per kg of packaging",
  },
};

/* ------------------------------------------------------------------ */
/* 5. Repair-avoided-emissions (used by the time-bank linkage registry) */
/* ------------------------------------------------------------------ */
export const REPAIR_AVOIDED = {
  home_repair: {
    grams: CONSUMPTION.household_goods.grams,
    source: "Modeled as the avoided manufacturing footprint of the replacement item that repair makes unnecessary",
  },
  electronics_repair: {
    grams: CONSUMPTION.electronics_large.grams,
    source: "Modeled as the avoided manufacturing footprint of a replacement device",
  },
};

export const AVOIDED_TRIP_BASELINE = {
  defaultKm: 8,
  mode: "petrol_car",
  source: "Assumed avoided commute distance for a remote/digital service substituting an in-person trip",
};
