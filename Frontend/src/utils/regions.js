/**
 * All Indian states and union territories. Keys match the GRID_FACTORS map in
 * Backend/src/data/scientificEmissionFactors.js exactly.
 *
 * Every region currently resolves to the same CEA national Weighted Average
 * Emission Factor (710 gCO2e/kWh) because India runs a unified, interconnected
 * national grid and CEA does not publish separate state-level consumption-side
 * factors. Listing every state anyway is deliberate: a user should never have
 * to pick a neighbouring state that isn't theirs, and if CEA ever publishes
 * state-level factors, only the backend map needs updating.
 */
export const REGIONS = [
  { key: "IN-AN", label: "Andaman & Nicobar Islands" },
  { key: "IN-AP", label: "Andhra Pradesh" },
  { key: "IN-AR", label: "Arunachal Pradesh" },
  { key: "IN-AS", label: "Assam" },
  { key: "IN-BR", label: "Bihar" },
  { key: "IN-CH", label: "Chandigarh" },
  { key: "IN-CT", label: "Chhattisgarh" },
  { key: "IN-DH", label: "Dadra & Nagar Haveli and Daman & Diu" },
  { key: "IN-DL", label: "Delhi" },
  { key: "IN-GA", label: "Goa" },
  { key: "IN-GJ", label: "Gujarat" },
  { key: "IN-HR", label: "Haryana" },
  { key: "IN-HP", label: "Himachal Pradesh" },
  { key: "IN-JK", label: "Jammu & Kashmir" },
  { key: "IN-JH", label: "Jharkhand" },
  { key: "IN-KA", label: "Karnataka" },
  { key: "IN-KL", label: "Kerala" },
  { key: "IN-LA", label: "Ladakh" },
  { key: "IN-LD", label: "Lakshadweep" },
  { key: "IN-MP", label: "Madhya Pradesh" },
  { key: "IN-MH", label: "Maharashtra" },
  { key: "IN-MN", label: "Manipur" },
  { key: "IN-ML", label: "Meghalaya" },
  { key: "IN-MZ", label: "Mizoram" },
  { key: "IN-NL", label: "Nagaland" },
  { key: "IN-OR", label: "Odisha" },
  { key: "IN-PY", label: "Puducherry" },
  { key: "IN-PB", label: "Punjab" },
  { key: "IN-RJ", label: "Rajasthan" },
  { key: "IN-SK", label: "Sikkim" },
  { key: "IN-TN", label: "Tamil Nadu" },
  { key: "IN-TG", label: "Telangana" },
  { key: "IN-TR", label: "Tripura" },
  { key: "IN-UP", label: "Uttar Pradesh" },
  { key: "IN-UT", label: "Uttarakhand" },
  { key: "IN-WB", label: "West Bengal" },
];

export const DEFAULT_REGION = "IN-PB";
