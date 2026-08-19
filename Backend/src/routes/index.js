import express from "express";
import { protect } from "../middleware/auth.js";

import * as auth from "../controllers/auth.controller.js";
import * as listing from "../controllers/listing.controller.js";
import * as txn from "../controllers/transaction.controller.js";
import * as carbon from "../controllers/carbon.controller.js";
import * as game from "../controllers/gamification.controller.js";
import * as insights from "../controllers/insights.controller.js";

const router = express.Router();

/* ---- Auth ---- */
router.post("/auth/register", auth.register);
router.post("/auth/login", auth.login);
router.get("/auth/me", protect, auth.me);
router.patch("/auth/profile", protect, auth.updateProfile);

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

export default router;
