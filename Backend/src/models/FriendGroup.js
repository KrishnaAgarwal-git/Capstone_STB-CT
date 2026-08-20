import mongoose from "mongoose";

const friendGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    inviteCode: { type: String, required: true, unique: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // FORMING (<5 members) hides leaderboards - a 2-person ranking is meaningless
    status: { type: String, enum: ["FORMING", "ACTIVE"], default: "FORMING" },
  },
  { timestamps: true }
);

friendGroupSchema.methods.refreshStatus = function () {
  this.status = this.members.length >= 5 ? "ACTIVE" : "FORMING";
};

export default mongoose.model("FriendGroup", friendGroupSchema);
