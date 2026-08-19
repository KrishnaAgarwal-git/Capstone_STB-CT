import { allBoards } from "../services/gamification/leaderboardService.js";
import { BADGE_TIERS, badgeForPoints } from "../services/gamification/pointsService.js";
import PointsLedger from "../models/PointsLedger.js";
import FriendGroup from "../models/FriendGroup.js";
import { asyncHandler, ok, badRequest, notFound } from "../utils/ApiError.js";

export const leaderboards = asyncHandler(async (req, res) => {
  const groupId = req.query.groupId || req.user.groups?.[0];
  if (!groupId) throw badRequest("You are not a member of any group yet");
  ok(res, await allBoards(groupId));
});

export const myPoints = asyncHandler(async (req, res) => {
  const ledger = await PointsLedger.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);

  ok(res, {
    points: req.user.points,
    badge: badgeForPoints(req.user.points),
    tiers: BADGE_TIERS,
    earned: req.user.badges,
    ledger,
  });
});

export const myGroup = asyncHandler(async (req, res) => {
  const groupId = req.user.groups?.[0];
  if (!groupId) throw badRequest("You are not a member of any group yet");

  const group = await FriendGroup.findById(groupId).populate(
    "members",
    "firstName lastName points badges credits"
  );
  if (!group) throw notFound("Group not found");

  ok(res, group);
});

export const joinGroup = asyncHandler(async (req, res) => {
  const { inviteCode } = req.body;
  const group = await FriendGroup.findOne({ inviteCode: (inviteCode || "").toUpperCase() });
  if (!group) throw notFound("No group with that invite code");

  if (group.members.length >= 50)
    throw badRequest("This group has reached the 50 member limit");

  if (!group.members.some((m) => String(m) === String(req.user._id))) {
    group.members.push(req.user._id);
    group.refreshStatus();
    await group.save();

    if (!req.user.groups.some((g) => String(g) === String(group._id))) {
      req.user.groups.push(group._id);
      await req.user.save();
    }
  }

  ok(res, group, `Joined ${group.name}`);
});
