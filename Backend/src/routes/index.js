import express from "express";
import { protect } from "../middleware/auth.js";

import * as auth from "../controllers/auth.controller.js";
import * as listing from "../controllers/listing.controller.js";
import * as txn from "../controllers/transaction.controller.js";
import * as carbon from "../controllers/carbon.controller.js";
import * as game from "../controllers/gamification.controller.js";
import * as insights from "../controllers/insights.controller.js";
import * as profile from "../controllers/profile.controller.js";
import { submitContact } from "../controllers/contact.controller.js";
import { previewEstimate } from "../controllers/recommendationPreview.controller.js";
import { requireEngineSecret } from "../middleware/engineAuth.js";
import { uploadAvatar } from "../middleware/upload.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* ---- Auth ---- */
router.post("/auth/register", auth.register);
router.post("/auth/login", auth.login);
router.post("/auth/verify-email", auth.verifyEmail);
router.post("/auth/resend-verification", auth.resendVerification);
router.post("/auth/forgot-password", auth.forgotPassword);
router.post("/auth/reset-password", auth.resetPassword);
router.get("/auth/me", protect, auth.me);
router.patch("/auth/profile", protect, auth.updateProfile);

/* ---- Profile (avatar) ---- */
router.post("/profile/avatar", protect, uploadAvatar, profile.uploadUserAvatar);
router.delete("/profile/avatar", protect, profile.deleteUserAvatar);

/* ---- Contact ---- */
const contactRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many messages sent. Please try again in a little while.",
});
router.post("/contact", contactRateLimit, submitContact);

/* ---- Service listings ---- */
router.post("/listings", protect, listing.createListing);
router.get("/listings", protect, listing.browseListings);
router.delete("/listings/:id", protect, listing.deleteListing);

/* ---- Transactions (time banking state machine) ---- */
router.get("/transactions", protect, txn.list);
router.post("/transactions", protect, txn.request);
router.patch("/transactions/:id/accept", protect, txn.accept);
router.patch("/transactions/:id/execute", protect, txn.execute);
router.patch("/transactions/:id/confirm", protect, txn.confirm);
router.patch("/transactions/:id/dispute", protect, txn.dispute);
router.patch("/transactions/:id/cancel", protect, txn.cancel);

/* ---- Carbon tracking ---- */
router.post("/carbon/activities", protect, carbon.logActivity);
router.get("/carbon/summary", protect, carbon.summary);
router.get("/carbon/activities", protect, carbon.history);
router.patch("/carbon/activities/:id/reverse", protect, carbon.reverse);
router.post("/carbon/ride-code", protect, carbon.rideCodeGenerate);
router.post("/carbon/ride-code/verify", protect, carbon.rideCodeVerify);

/* ---- Gamification and groups ---- */
router.get("/leaderboards", protect, game.leaderboards);
router.get("/points", protect, game.myPoints);
router.get("/group", protect, game.myGroup);
router.post("/group/join", protect, game.joinGroup);

/* ---- AI Insights (rule-based recommendation engine) ---- */
router.get("/insights", protect, insights.getInsights);
router.post("/insights/feedback", protect, insights.submitFeedback);

/* ---- Recommendation engine integration contract (service-to-service) ---- */
router.post("/recommendations/preview", requireEngineSecret, previewEstimate);

export default router;
