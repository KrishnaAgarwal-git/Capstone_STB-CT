import mongoose from "mongoose";
import { SERVICE_CATEGORY_KEYS } from "../config/constants.js";

const serviceListingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    // Enum, not free text - the linkage registry looks up by this exact key
    category: { type: String, enum: SERVICE_CATEGORY_KEYS, required: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "FriendGroup", required: true, index: true },
    estimatedHours: { type: Number, required: true, min: 0.25, max: 8 },
    isActive: { type: Boolean, default: true },
    isTemplate: { type: Boolean, default: false }, // cold-start seed listings
  },
  { timestamps: true }
);

export default mongoose.model("ServiceListing", serviceListingSchema);
