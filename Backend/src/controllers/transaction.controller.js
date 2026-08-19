import * as txnService from "../services/timeBanking/transactionService.js";
import { asyncHandler, ok, created } from "../utils/ApiError.js";
import { kmToMetres } from "../utils/units.js";

export const request = asyncHandler(async (req, res) => {
  const { listingId, hours, scheduledFor, distanceKm, participants } = req.body;

  const tripData = distanceKm
    ? {
        distanceMetres: kmToMetres(distanceKm),
        participants: Number(participants) || 2,
      }
    : undefined;

  const txn = await txnService.requestService({
    user: req.user,
    listingId,
    hours,
    scheduledFor,
    tripData,
  });

  created(res, txn, "Service requested");
});

export const accept = asyncHandler(async (req, res) => {
  const txn = await txnService.acceptRequest({ user: req.user, txnId: req.params.id });
  ok(res, txn, "Request accepted");
});

export const execute = asyncHandler(async (req, res) => {
  const txn = await txnService.markExecuted({ user: req.user, txnId: req.params.id });
  ok(res, txn, "Marked as delivered - waiting for the other side to confirm");
});

export const confirm = asyncHandler(async (req, res) => {
  const { actualHours, rating, comment } = req.body;
  const result = await txnService.confirmTransaction({
    user: req.user,
    txnId: req.params.id,
    actualHours,
    rating,
    comment,
  });

  ok(
    res,
    result,
    result.completed
      ? result.linkedActivityId
        ? "Confirmed. Credits transferred and a carbon activity was created automatically."
        : "Confirmed. Credits transferred."
      : "Your confirmation is recorded - waiting for the other side."
  );
});

export const dispute = asyncHandler(async (req, res) => {
  const txn = await txnService.disputeTransaction({
    user: req.user,
    txnId: req.params.id,
    reason: req.body.reason,
  });
  ok(res, txn, "Transaction disputed");
});

export const cancel = asyncHandler(async (req, res) => {
  const txn = await txnService.cancelTransaction({ user: req.user, txnId: req.params.id });
  ok(res, txn, "Transaction cancelled");
});

export const list = asyncHandler(async (req, res) => {
  const txns = await txnService.listTransactions({ user: req.user, status: req.query.status });
  ok(res, txns);
});
