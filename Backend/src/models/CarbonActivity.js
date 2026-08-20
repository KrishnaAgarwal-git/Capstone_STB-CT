import mongoose from "mongoose";
import { CARBON_DOMAINS } from "../config/constants.js";

const carbonActivitySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    domain: { type: String, enum: CARBON_DOMAINS, required: true, index: true },
    subtype: { type: String, required: true }, // e.g. private_car, grid_electricity, red_meat

    // Canonical units
    emissionsGrams: { type: Number, required: true }, // positive = emitted
    savedGrams: { type: Number, default: 0 }, // positive = avoided vs baseline

    // Raw inputs kept for auditability
    inputs: { type: mongoose.Schema.Types.Mixed, default: {} },

    emissionFactorVersion: { type: String, default: "ghgp-2015-v1" },
    distanceSource: { type: String, enum: ["api", "haversine", "manual", "n/a"], default: "n/a" },

    // Provenance - proves the time-bank <-> carbon integration
    source: { type: String, enum: ["manual", "time_bank_linked"], default: "manual", index: true },
    sourceTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },

    verificationStatus: {
      type: String,
      enum: ["unverified", "verified", "flagged"],
      default: "unverified",
    },
    verificationNote: { type: String },

    // Append-only: edits write a reversal instead of mutating
    isReversal: { type: Boolean, default: false },
    reverses: { type: mongoose.Schema.Types.ObjectId, ref: "CarbonActivity" },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "CarbonActivity" },

    occurredAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// A user can only claim one carbon record per source transaction.
// This is what blocks shared-ride double-counting at the database level.
carbonActivitySchema.index(
  { sourceTransaction: 1, user: 1 },
  { unique: true, partialFilterExpression: { sourceTransaction: { $exists: true } } }
);

carbonActivitySchema.index({ user: 1, occurredAt: -1 });

export default mongoose.model("CarbonActivity", carbonActivitySchema);
