import User from "../models/User.js";
import FriendGroup from "../models/FriendGroup.js";
import { signToken } from "../middleware/auth.js";
import { asyncHandler, badRequest, unauthorized, forbidden, ok, created } from "../utils/ApiError.js";
import { generateInviteCode } from "../utils/inviteCode.js";
import { generateToken, hashToken, TOKEN_EXPIRY_MS } from "../utils/tokens.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/email.service.js";

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

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
  isVerified: u.isVerified,
  avatarUrl: u.avatarUrl,
});

export const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, region } = req.body;

  if (!firstName || !lastName || !email || !password)
    throw badRequest("All fields are required");
  if (password.length < 6) throw badRequest("Password must be at least 6 characters");

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw badRequest("An account with that email already exists");

  const { raw, hash } = generateToken();

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    region: region || "IN-PB",
    isVerified: false,
    verificationTokenHash: hash,
    verificationTokenExpiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS.verification),
  });

  // Every new user becomes the owner of their own real friend group with a
  // unique, randomly generated invite code - no shared/seeded group. They
  // invite real friends into it via the code (see /group/join). The group
  // starts in FORMING status (leaderboards hidden) until it reaches 5 members.
  let inviteCode;
  let clash;
  do {
    inviteCode = generateInviteCode();
    clash = await FriendGroup.findOne({ inviteCode });
  } while (clash);

  const group = await FriendGroup.create({
    name: `${firstName}'s Circle`,
    description: "",
    inviteCode,
    owner: user._id,
    members: [user._id],
  });
  group.refreshStatus();
  await group.save();

  user.groups = [group._id];
  await user.save();

  const verificationUrl = `${FRONTEND_URL}/verify-email?token=${raw}`;
  await sendVerificationEmail({ to: user.email, name: firstName, verificationUrl });

  // No JWT issued yet - the account must be verified before signing in.
  created(
    res,
    {
      requiresVerification: true,
      email: user.email,
      group: { name: group.name, inviteCode: group.inviteCode },
    },
    "Account created - check your email to verify"
  );
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) throw badRequest("Verification token is required");

  const hash = hashToken(token);
  const user = await User.findOne({ verificationTokenHash: hash }).select(
    "+verificationTokenHash +verificationTokenExpiresAt"
  );

  if (!user) throw badRequest("Invalid or already-used verification link");
  if (user.verificationTokenExpiresAt < new Date())
    throw badRequest("This verification link has expired - request a new one");

  user.isVerified = true;
  user.verificationTokenHash = undefined;
  user.verificationTokenExpiresAt = undefined;
  await user.save();

  ok(res, { token: signToken(user._id), user: publicUser(user) }, "Email verified");
});

export const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw badRequest("Email is required");

  const user = await User.findOne({ email: email.toLowerCase() });
  // Always return success even if the account doesn't exist or is already
  // verified, so this endpoint can't be used to enumerate registered emails.
  if (!user || user.isVerified) {
    return ok(res, null, "If that account needs verification, a new email has been sent");
  }

  const { raw, hash } = generateToken();
  user.verificationTokenHash = hash;
  user.verificationTokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS.verification);
  await user.save();

  const verificationUrl = `${FRONTEND_URL}/verify-email?token=${raw}`;
  await sendVerificationEmail({ to: user.email, name: user.firstName, verificationUrl });

  ok(res, null, "If that account needs verification, a new email has been sent");
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw badRequest("Email and password are required");

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (!user) throw unauthorized("Invalid email or password");

  const match = await user.comparePassword(password);
  if (!match) throw unauthorized("Invalid email or password");

  if (!user.isVerified) {
    const err = forbidden("Please verify your email before signing in");
    err.code = "EMAIL_NOT_VERIFIED";
    throw err;
  }

  ok(res, { token: signToken(user._id), user: publicUser(user) }, "Signed in");
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw badRequest("Email is required");

  const user = await User.findOne({ email: email.toLowerCase() });
  // Always return the same generic success message, whether or not the
  // account exists, so this endpoint can't be used to enumerate emails.
  if (!user) {
    return ok(res, null, "If an account exists for that email, a reset link has been sent");
  }

  const { raw, hash } = generateToken();
  user.resetTokenHash = hash;
  user.resetTokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS.passwordReset);
  await user.save();

  const resetUrl = `${FRONTEND_URL}/reset-password?token=${raw}`;
  await sendPasswordResetEmail({ to: user.email, name: user.firstName, resetUrl });

  ok(res, null, "If an account exists for that email, a reset link has been sent");
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) throw badRequest("Token and new password are required");
  if (password.length < 6) throw badRequest("Password must be at least 6 characters");

  const hash = hashToken(token);
  const user = await User.findOne({ resetTokenHash: hash }).select(
    "+resetTokenHash +resetTokenExpiresAt"
  );

  if (!user) throw badRequest("Invalid or already-used reset link");
  if (user.resetTokenExpiresAt < new Date())
    throw badRequest("This reset link has expired - request a new one");

  user.password = password; // pre-save hook re-hashes
  user.resetTokenHash = undefined;
  user.resetTokenExpiresAt = undefined;
  await user.save();

  ok(res, null, "Password updated - sign in with your new password");
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
