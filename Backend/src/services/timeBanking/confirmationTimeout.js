import Transaction from "../../models/Transaction.js";
import User from "../../models/User.js";
import { withTransaction } from "../../config/db.js";
import { transfer } from "./creditLedgerService.js";
import { getLinkage } from "../integration/carbonLinkageRegistry.js";
import { createActivity } from "../carbonTracking/carbonCalculationEngine.js";
import { eventBus, EVENTS } from "../../events/eventBus.js";
import { TRANSACTION_STATUS as S } from "../../config/constants.js";

/**
 * Resolves confirmation deadlock (one party confirms, the other never does).
 *
 * Rule:
 *  - Receiver confirmed, provider did not  -> auto-complete.
 *    The beneficiary confirmed the benefit, so this is safe.
 *  - Provider confirmed, receiver did not  -> DISPUTED, no credits move.
 *    This is the direction fraud flows, so it must never auto-credit.
 */
export const resolveExpiredConfirmations = async () => {
  const expired = await Transaction.find({
    status: S.EXECUTED,
    confirmationDeadline: { $lte: new Date() },
  }).limit(100);

  for (const txn of expired) {
    try {
      if (txn.receiverConfirmed && !txn.providerConfirmed) {
        const receiverDoc = await User.findById(txn.receiver);
        const linkage = getLinkage(txn.category);
        let linkedActivityId = null;

        await withTransaction(async (session) => {
          await transfer({
            from: txn.receiver,
            to: txn.provider,
            amount: txn.credits,
            session,
          });

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

          txn.status = S.COMPLETED;
          txn.completedAt = new Date();
          txn.providerConfirmed = true;
          txn.linkedCarbonActivity = linkedActivityId;
          await txn.save(session ? { session } : {});
        });

        eventBus.emit(EVENTS.TRANSACTION_COMPLETED, {
          transactionId: txn._id,
          providerId: txn.provider,
          receiverId: txn.receiver,
          groupId: txn.group,
          category: txn.category,
          credits: txn.credits,
          linkedActivityId,
        });

        console.log(`[timeout] auto-completed transaction ${txn._id}`);
      } else {
        txn.status = S.DISPUTED;
        txn.disputeReason = "Confirmation window expired without receiver confirmation";
        await txn.save();
        console.log(`[timeout] disputed transaction ${txn._id}`);
      }
    } catch (err) {
      console.error(`[timeout] failed on ${txn._id}:`, err.message);
    }
  }
};

let timer = null;

export const startScheduler = () => {
  if (timer) return;
  // Every 15 minutes. Runs once shortly after boot too.
  timer = setInterval(resolveExpiredConfirmations, 15 * 60 * 1000);
  setTimeout(resolveExpiredConfirmations, 10000);
  console.log("Confirmation timeout scheduler started");
};

export const stopScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
