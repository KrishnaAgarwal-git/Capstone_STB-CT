/**
 * Seeds a demo friend group with 5 users, service listings, and carbon history.
 * Run with:  npm run seed
 *
 * Login for any seeded user:  <email> / password123
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const connectDB = (await import("../config/db.js")).default;
const User = (await import("../models/User.js")).default;
const FriendGroup = (await import("../models/FriendGroup.js")).default;
const ServiceListing = (await import("../models/ServiceListing.js")).default;
const CarbonActivity = (await import("../models/CarbonActivity.js")).default;
const Transaction = (await import("../models/Transaction.js")).default;
const PointsLedger = (await import("../models/PointsLedger.js")).default;

const PEOPLE = [
  { firstName: "Animesh", lastName: "Kumar", email: "animesh@stbct.dev" },
  { firstName: "Kreetika", lastName: "Rana", email: "kreetika@stbct.dev" },
  { firstName: "Krishna", lastName: "Agarwal", email: "krishna@stbct.dev" },
  { firstName: "Parkhi", lastName: "Singhal", email: "parkhi@stbct.dev" },
  { firstName: "Shubham", lastName: "Saini", email: "shubham@stbct.dev" },
];

const LISTINGS = [
  { title: "Data structures tutoring", category: "tutoring_remote", estimatedHours: 1.5,
    description: "Trees, graphs, and dynamic programming over a call." },
  { title: "Campus ride share - morning", category: "ride_share", estimatedHours: 0.5,
    description: "Sharing my commute to campus, room for two." },
  { title: "Laptop and Wi-Fi troubleshooting", category: "digital_help", estimatedHours: 1,
    description: "Software setup, drivers, and network issues." },
  { title: "Furniture and shelf repair", category: "home_repair", estimatedHours: 2,
    description: "Fixing rather than replacing - bring me the broken thing." },
  { title: "Grocery run for two", category: "shared_errand", estimatedHours: 1,
    description: "Heading to the market, happy to pick up your list too." },
  { title: "Resume and portfolio review", category: "general_assistance", estimatedHours: 1,
    description: "Detailed written feedback on your CV." },
];

const run = async () => {
  await connectDB();

  console.log("Clearing existing demo data...");
  await Promise.all([
    User.deleteMany({ email: /@stbct\.dev$/ }),
    FriendGroup.deleteMany({ inviteCode: "DEMO01" }),
    ServiceListing.deleteMany({}),
    Transaction.deleteMany({}),
    CarbonActivity.deleteMany({}),
    PointsLedger.deleteMany({}),
  ]);

  console.log("Creating users...");
  const users = [];
  for (const p of PEOPLE) {
    const u = new User({ ...p, password: "password123", region: "IN-PB", credits: 80 });
    await u.save();
    users.push(u);
  }

  console.log("Creating friend group...");
  const group = await FriendGroup.create({
    name: "Thapar Capstone Circle",
    description: "CPG 266 demo group",
    inviteCode: "DEMO01",
    owner: users[0]._id,
    members: users.map((u) => u._id),
    status: "ACTIVE",
  });

  await User.updateMany({ _id: { $in: users.map((u) => u._id) } }, { groups: [group._id] });

  console.log("Creating service listings...");
  for (let i = 0; i < LISTINGS.length; i++) {
    await ServiceListing.create({
      ...LISTINGS[i],
      provider: users[i % users.length]._id,
      group: group._id,
    });
  }

  console.log("Creating carbon history...");
  const subtypes = [
    { domain: "transportation", subtype: "public_transit", emissions: 500, saved: 1600 },
    { domain: "transportation", subtype: "private_car", emissions: 2100, saved: 0 },
    { domain: "transportation", subtype: "two_wheeler", emissions: 860, saved: 1200 },
    { domain: "electricity", subtype: "grid_electricity", emissions: 4200, saved: 0 },
    { domain: "food", subtype: "vegetarian", emissions: 700, saved: 0 },
    { domain: "food", subtype: "red_meat", emissions: 6900, saved: 0 },
    { domain: "consumption", subtype: "household_goods", emissions: 5200, saved: 0 },
  ];

  for (const user of users) {
    for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
      const perMonth = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < perMonth; k++) {
        const s = subtypes[Math.floor(Math.random() * subtypes.length)];
        const when = new Date();
        when.setMonth(when.getMonth() - monthsAgo);
        when.setDate(1 + Math.floor(Math.random() * 26));

        // Later months trend greener, so the improvement board has signal
        const greenBias = 1 - (5 - monthsAgo) * 0.08;

        await CarbonActivity.create({
          user: user._id,
          domain: s.domain,
          subtype: s.subtype,
          emissionsGrams: Math.round(s.emissions * greenBias * (0.8 + Math.random() * 0.4)),
          savedGrams: Math.round(s.saved * (0.8 + Math.random() * 0.4)),
          inputs: { seeded: true },
          occurredAt: when,
          source: "manual",
          verificationStatus: "unverified",
        });
      }
    }
  }

  console.log("\nSeed complete.");
  console.log(`  Group invite code: DEMO01`);
  console.log(`  Users: ${PEOPLE.map((p) => p.email).join(", ")}`);
  console.log(`  Password for all: password123\n`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
