import User from "../../models/User.js";
import { MAX_CREDIT_BALANCE } from "../../config/constants.js";
import { badRequest, conflict } from "../../utils/ApiError.js";

/**
 * Race-safe debit. The balance check and the decrement are ONE operation, so
 * two concurrent requests can never both pass a read-then-write check and
 * drive the balance negative.
 */
export const debit = async (userId, amount, session = null) => {
  if (amount <= 0) throw badRequest("Debit amount must be positive");

  const res = await User.updateOne(
    { _id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount } },
    session ? { session } : {}
  );

  if (res.modifiedCount === 0) {
    throw conflict("Insufficient credits");
  }
  return true;
};

/**
 * Credit with a hard cap. Credits are meant to circulate, not accumulate
 * (Cahn's co-production model), so we refuse to push a balance past the cap.
 */
export const credit = async (userId, amount, session = null) => {
  if (amount <= 0) throw badRequest("Credit amount must be positive");

  const res = await User.updateOne(
    { _id: userId, credits: { $lte: MAX_CREDIT_BALANCE - amount } },
    { $inc: { credits: amount } },
    session ? { session } : {}
  );

  if (res.modifiedCount === 0) {
    throw conflict(
      `Recipient would exceed the maximum balance of ${MAX_CREDIT_BALANCE} credits - they should spend some first`
    );
  }
  return true;
};

/** Transfer = debit receiver, credit provider. Order matters without sessions. */
export const transfer = async ({ from, to, amount, session = null }) => {
  await debit(from, amount, session);
  try {
    await credit(to, amount, session);
  } catch (err) {
    // Compensating write when running without transactions (standalone mongod)
    if (!session) {
      await User.updateOne({ _id: from }, { $inc: { credits: amount } });
    }
    throw err;
  }
  return true;
};

export const getBalance = async (userId) => {
  const u = await User.findById(userId).select("credits");
  return u ? u.credits : 0;
};
