import { generateInsights } from "../services/insights/recommendationEngine.js";
import { asyncHandler, ok } from "../utils/ApiError.js";

export const getInsights = asyncHandler(async (req, res) => {
  const insights = await generateInsights(req.user._id);
  ok(res, { insights });
});
