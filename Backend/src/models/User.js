import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { STARTING_CREDITS } from "../config/constants.js";

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },

    // Time banking
    credits: { type: Number, default: STARTING_CREDITS, min: 0 },

    // Gamification
    points: { type: Number, default: 0 },
    badges: [{ type: String }],

    // Carbon context
    region: { type: String, default: "IN-PB" }, // needed for EV grid-mix adjustment
    ownsEV: { type: Boolean, default: false },

    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "FriendGroup" }],

    // Reputation
    servicesProvided: { type: Number, default: 0 },
    servicesReceived: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    // Email verification
    isVerified: { type: Boolean, default: false },
    verificationTokenHash: { type: String, select: false },
    verificationTokenExpiresAt: { type: Date, select: false },

    // Password reset
    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false },

    // Profile
    avatarUrl: { type: String, default: null },
  },
  { timestamps: true }
);

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual("rating").get(function () {
  return this.ratingCount ? Number((this.ratingSum / this.ratingCount).toFixed(2)) : null;
});

userSchema.set("toJSON", { virtuals: true });
userSchema.set("toObject", { virtuals: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export default mongoose.model("User", userSchema);
