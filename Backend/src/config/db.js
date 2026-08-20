import mongoose from "mongoose";

// Set to true once we confirm the deployment supports multi-document transactions.
export let supportsTransactions = false;

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set in .env");

  await mongoose.connect(uri);
  console.log("MongoDB connected");

  // Detect replica set support. Atlas => yes. Standalone local mongod => no.
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    supportsTransactions = Boolean(info.setName || info.msg === "isdbgrid");
  } catch {
    supportsTransactions = false;
  }

  console.log(
    supportsTransactions
      ? "Replica set detected - atomic transactions enabled"
      : "Standalone MongoDB - running in compensating-write mode (use Atlas for full atomicity)"
  );
};

/**
 * Runs `fn(session)` inside a transaction when supported, otherwise runs it
 * with session = null. Callers must be written so they still behave correctly
 * without a session (we order writes so the risky one happens first).
 */
export const withTransaction = async (fn) => {
  if (!supportsTransactions) {
    return fn(null);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export default connectDB;
