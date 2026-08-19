import User from "../models/User.js";
import FriendGroup from "../models/FriendGroup.js";
import { signToken } from "../middleware/auth.js";
import { asyncHandler, badRequest, unauthorized, ok, created } from "../utils/ApiError.js";

const publicUser = (u) => ({
  id: u._id,
  firstName: u.firstName,
  lastName: u.lastName,
  name: `${u.firstName} ${u.lastName}`,
  email: u.email,
  credits: u.credits,
  points: u.points,
  badges: u.badges,
  region: u.region,
  groups: u.groups,
});

export const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, region } = req.body;

  if (!firstName || !lastName || !email || !password)
    throw badRequest("All fields are required");
  if (password.length < 6) throw badRequest("Password must be at least 6 characters");

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw badRequest("An account with that email already exists");

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    region: region || "IN-PB",
  });

  // Auto-join a default demo group so nothing is empty on first login
  let group = await FriendGroup.findOne({ inviteCode: "DEMO01" });
  if (!group) {
    group = await FriendGroup.create({
      name: "Demo Friend Circle",
      description: "Default group for new users",
      inviteCode: "DEMO01",
      owner: user._id,
      members: [user._id],
    });
  } else if (!group.members.includes(user._id)) {
    group.members.push(user._id);
  }
  group.refreshStatus();
  await group.save();

  user.groups = [group._id];
  await user.save();

  created(res, { token: signToken(user._id), user: publicUser(user) }, "Account created");
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw badRequest("Email and password are required");

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (!user) throw unauthorized("Invalid email or password");

  const match = await user.comparePassword(password);
  if (!match) throw unauthorized("Invalid email or password");

  ok(res, { token: signToken(user._id), user: publicUser(user) }, "Signed in");
});

export const me = asyncHandler(async (req, res) => {
  ok(res, { user: publicUser(req.user) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { region, ownsEV } = req.body;
  if (region !== undefined) req.user.region = region;
  if (ownsEV !== undefined) req.user.ownsEV = Boolean(ownsEV);
  await req.user.save();
  ok(res, { user: publicUser(req.user) }, "Profile updated");
});
