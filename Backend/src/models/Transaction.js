import mongoose from "mongoose";
import { SERVICE_CATEGORY_KEYS, TRANSACTION_STATUS } from "../config/constants.js";

const transactionSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceListing", required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "FriendGroup", required: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, enum: SERVICE_CATEGORY_KEYS, required: true },

    hours: { type: Number, required: true, min: 0.25 },
    credits: { type: Number, required: true, min: 1 },

    status: {
      type: String,
      enum: Object.values(TRANSACTION_STATUS),
      default: TRANSACTION_STATUS.REQUESTED,
      index: true,
    },

    scheduledFor: { type: Date },

    // Mutual confirmation - credits only move when both are true
    providerConfirmed: { type: Boolean, default: false },
    receiverConfirmed: { type: Boolean, default: false },
    confirmationDeadline: { type: Date },

    // Optional trip data for transport-linked categories
    tripData: {
      distanceMetres: { type: Number },
      mode: { type: String },
      participants: { type: Number, default: 2 },
    },

    linkedCarbonActivity: { type: mongoose.Schema.Types.ObjectId, ref: "CarbonActivity" },

    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String, trim: true },
    },

    disputeReason: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

transactionSchema.index({ provider: 1, receiver: 1, createdAt: -1 });

export default mongoose.model("Transaction", transactionSchema);
