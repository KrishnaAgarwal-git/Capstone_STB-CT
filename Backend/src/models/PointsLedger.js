import mongoose from "mongoose";

const pointsLedgerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "FriendGroup", index: true },
    points: { type: Number, required: true }, // negative for clawbacks
    reason: { type: String, required: true },
    refType: { type: String, enum: ["transaction", "carbon", "system"], default: "system" },
    refId: { type: mongoose.Schema.Types.ObjectId },
    // Excluded from leaderboards when the collusion guard flags the pair
    countsForLeaderboard: { type: Boolean, default: true },
  },
  { timestamps: true }
);

pointsLedgerSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("PointsLedger", pointsLedgerSchema);
