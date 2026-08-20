import { getRecommendations, sendRecommendationFeedback } from "../services/insights/recommendationBridge.js";
import { asyncHandler, ok } from "../utils/ApiError.js";

export const getInsights = asyncHandler(async (req, res) => {
  const result = await getRecommendations(req.user);
  ok(res, result);
});

export const submitFeedback = asyncHandler(async (req, res) => {
  const { recommendationId, eventType } = req.body;
  const result = await sendRecommendationFeedback(req.user, recommendationId, eventType);
  ok(res, result, result.message || "Feedback recorded");
});
