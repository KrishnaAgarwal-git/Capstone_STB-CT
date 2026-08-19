import Transaction from "../../models/Transaction.js";
import ServiceListing from "../../models/ServiceListing.js";
import User from "../../models/User.js";
import { withTransaction } from "../../config/db.js";
import { transfer } from "./creditLedgerService.js";
import { getLinkage } from "../integration/carbonLinkageRegistry.js";
import { createActivity } from "../carbonTracking/carbonCalculationEngine.js";
import { checkPairVelocity, checkDailyHours } from "./collusionGuard.js";
import { eventBus, EVENTS } from "../../events/eventBus.js";
import {
  CREDITS_PER_HOUR,
  CONFIRMATION_TIMEOUT_HOURS,
  TRANSACTION_STATUS as S,
} from "../../config/constants.js";
import { badRequest, notFound, forbidden, conflict } from "../../utils/ApiError.js";
import { hoursToCredits } from "../../utils/units.js";

/** Step 1: a receiver requests a service from a listing. */
export const requestService = async ({ user, listingId, hours, scheduledFor, tripData }) => {
  const listing = await ServiceListing.findById(listingId).populate("provider", "_id");
  if (!listing || !listing.isActive) throw notFound("Service listing not found");
  if (String(listing.provider._id) === String(user._id))
    throw badRequest("You cannot request your own service");

  const h = Number(hours) || listing.estimatedHours;
  if (h < 0.25) throw badRequest("Minimum service duration is 15 minutes");

  const credits = hoursToCredits(h, CREDITS_PER_HOUR);

  // Balance is checked here for a fast, friendly error. The authoritative
  // check is the atomic debit at completion time.
  const receiver = await User.findById(user._id).select("credits");
  if (receiver.credits < credits)
    throw conflict(
      `You need ${credits} credits for this service but only have ${receiver.credits}.`
    );

  await checkPairVelocity(user._id, listing.provider._id);
  await checkDailyHours(listing.provider._id, h);

  const txn = await Transaction.create({
    listing: listing._id,
    group: listing.group,
    provider: listing.provider._id,
    receiver: user._id,
    category: listing.category,
    hours: h,
    credits,
    status: S.REQUESTED,
    scheduledFor: scheduledFor || null,
    tripData: tripData || undefined,
  });

  return txn;
};

/** Step 2: provider accepts. */
export const acceptRequest = async ({ user, txnId }) => {
  const txn = await Transaction.findById(txnId);
  if (!txn) throw notFound("Transaction not found");
  if (String(txn.provider) !== String(user._id))
    throw forbidden("Only the provider can accept this request");
  if (txn.status !== S.REQUESTED)
    throw badRequest(`Cannot accept a transaction in status ${txn.status}`);

  txn.status = S.ACCEPTED;
  await txn.save();
  return txn;
};

/** Step 3: provider marks the service as delivered, starting the confirmation clock. */
export const markExecuted = async ({ user, txnId }) => {
  const txn = await Transaction.findById(txnId);
  if (!txn) throw notFound("Transaction not found");
  if (String(txn.provider) !== String(user._id))
    throw forbidden("Only the provider can mark this as delivered");
  if (txn.status !== S.ACCEPTED)
    throw badRequest(`Cannot mark executed from status ${txn.status}`);

  txn.status = S.EXECUTED;
  txn.providerConfirmed = true;
  txn.confirmationDeadline = new Date(Date.now() + CONFIRMATION_TIMEOUT_HOURS * 3600000);
  await txn.save();
  return txn;
};

/**
 * Step 4: MUTUAL CONFIRMATION -> credits move and, if the category is linked,
 * a carbon activity is created in the SAME atomic unit.
 *
 * The completion event is emitted only AFTER a successful commit, so
 * gamification can never award points for a transaction that rolled back.
 */
export const confirmTransaction = async ({ user, txnId, actualHours, rating, comment }) => {
  const txn = await Transaction.findById(txnId);
  if (!txn) throw notFound("Transaction not found");

  const isProvider = String(txn.provider) === String(user._id);
  const isReceiver = String(txn.receiver) === String(user._id);
  if (!isProvider && !isReceiver) throw forbidden("You are not part of this transaction");

  if (![S.EXECUTED, S.ACCEPTED].includes(txn.status))
    throw badRequest(`Cannot confirm a transaction in status ${txn.status}`);

  // Partial delivery: take the LOWER of the two claimed values, which removes
  // any incentive for the provider to inflate hours.
  if (actualHours && Number(actualHours) > 0) {
    const claimed = Number(actualHours);
    if (claimed < txn.hours) {
      txn.hours = claimed;
      txn.credits = hoursToCredits(claimed, CREDITS_PER_HOUR);
    }
  }

  if (isProvider) txn.providerConfirmed = true;
  if (isReceiver) {
    txn.receiverConfirmed = true;
    if (rating) txn.feedback = { rating: Number(rating), comment: comment || "" };
  }

  // Not both sides yet - save and wait
  if (!(txn.providerConfirmed && txn.receiverConfirmed)) {
    if (txn.status === S.ACCEPTED) {
      txn.status = S.EXECUTED;
      txn.confirmationDeadline = new Date(Date.now() + CONFIRMATION_TIMEOUT_HOURS * 3600000);
    }
    await txn.save();
    return { transaction: txn, completed: false };
  }

  const receiverDoc = await User.findById(txn.receiver);
  const linkage = getLinkage(txn.category);

  let linkedActivityId = null;

  await withTransaction(async (session) => {
    // 1. Move credits (race-safe, floor at 0, cap enforced)
    await transfer({ from: txn.receiver, to: txn.provider, amount: txn.credits, session });

    // 2. THE INTEGRATION: linked categories auto-create a carbon activity
    if (linkage) {
      const result = linkage.calculate(txn);
      const activity = await createActivity({
        user: receiverDoc,
        domain: linkage.domain,
        subtype: result.subtype,
        payload: result.payload,
        occurredAt: new Date(),
        source: "time_bank_linked",
        sourceTransaction: txn._id,
        session,
        precomputed: {
          emissionsGrams: result.emissionsGrams,
          savedGrams: result.savedGrams,
          verificationStatus: result.verificationStatus,
          verificationNote: result.verificationNote,
        },
      });
      linkedActivityId = activity._id;
    }

    // 3. Close the transaction
    txn.status = S.COMPLETED;
    txn.completedAt = new Date();
    txn.linkedCarbonActivity = linkedActivityId;
    await txn.save(session ? { session } : {});

    // 4. Reputation counters
    await User.updateOne(
      { _id: txn.provider },
      {
        $inc: {
          servicesProvided: 1,
          ...(txn.feedback?.rating
            ? { ratingSum: txn.feedback.rating, ratingCount: 1 }
            : {}),
        },
      },
      session ? { session } : {}
    );
    await User.updateOne(
      { _id: txn.receiver },
      { $inc: { servicesReceived: 1 } },
      session ? { session } : {}
    );
  });

  // Emitted AFTER commit - never inside the transaction
  eventBus.emit(EVENTS.TRANSACTION_COMPLETED, {
    transactionId: txn._id,
    providerId: txn.provider,
    receiverId: txn.receiver,
    groupId: txn.group,
    category: txn.category,
    credits: txn.credits,
    linkedActivityId,
  });

  return { transaction: txn, completed: true, linkedActivityId };
};

/** Either party can raise a dispute - no credits move. */
export const disputeTransaction = async ({ user, txnId, reason }) => {
  const txn = await Transaction.findById(txnId);
  if (!txn) throw notFound("Transaction not found");
  if (![String(txn.provider), String(txn.receiver)].includes(String(user._id)))
    throw forbidden("You are not part of this transaction");
  if (txn.status === S.COMPLETED) throw badRequest("Completed transactions cannot be disputed");

  txn.status = S.DISPUTED;
  txn.disputeReason = reason || "No reason given";
  await txn.save();

  eventBus.emit(EVENTS.TRANSACTION_DISPUTED, { transactionId: txn._id });
  return txn;
};

export const cancelTransaction = async ({ user, txnId }) => {
  const txn = await Transaction.findById(txnId);
  if (!txn) throw notFound("Transaction not found");
  if (![String(txn.provider), String(txn.receiver)].includes(String(user._id)))
    throw forbidden("You are not part of this transaction");
  if ([S.COMPLETED, S.CANCELLED].includes(txn.status))
    throw badRequest(`Cannot cancel a transaction in status ${txn.status}`);

  txn.status = S.CANCELLED;
  await txn.save();
  return txn;
};

export const listTransactions = async ({ user, status }) => {
  const query = { $or: [{ provider: user._id }, { receiver: user._id }] };
  if (status) query.status = status;

  return Transaction.find(query)
    .populate("provider", "firstName lastName email")
    .populate("receiver", "firstName lastName email")
    .populate("listing", "title category")
    .sort({ createdAt: -1 })
    .limit(100);
};
