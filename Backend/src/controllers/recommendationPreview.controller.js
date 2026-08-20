import { resolveActivityEstimate } from "../data/activityKeyMapping.js";
import { getVersion } from "../services/carbonTracking/emissionFactorService.js";
import { asyncHandler, badRequest } from "../utils/ApiError.js";

/**
 * Implements the exact contract the recommendation engine's
 * HttpCarbonCalculationClient expects (see CARBON_ENGINE_INTEGRATION.md §3.1
 * in the engine repo). This is the ONE endpoint that lets the Python engine
 * plug into this app's real, cited emission factor data with the "one-line
 * change" its own docs describe:
 *
 *   CARBON_CLIENT = HttpCarbonCalculationClient(base_url="http://localhost:5000/api/v1")
 *
 * Request:
 *   POST /api/v1/recommendations/preview
 *   { baseline_activity, baseline_quantity, unit, region_code, candidate_alternatives: [] }
 *
 * Response:
 *   { baseline_emissions_kg, emission_factor: { unit, source, version }, calculation_confidence }
 */
export const previewEstimate = asyncHandler(async (req, res) => {
  const { baseline_activity, baseline_quantity, unit, region_code, category } = req.body;

  if (!baseline_activity) throw badRequest("baseline_activity is required");
  if (baseline_quantity === undefined || baseline_quantity === null)
    throw badRequest("baseline_quantity is required");

  const result = resolveActivityEstimate({
    activityKey: baseline_activity,
    quantity: Number(baseline_quantity),
    unit,
    regionCode: region_code || "GLOBAL",
    category,
  });

  res.json({
    baseline_emissions_kg: result.co2eKg,
    emission_factor: {
      unit: result.factorUnit,
      source: result.factorSource,
      version: getVersion(),
    },
    calculation_confidence: result.confidence,
  });
});
