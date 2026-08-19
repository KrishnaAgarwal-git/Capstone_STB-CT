import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { unauthorized } from "../utils/ApiError.js";

export const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

export const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return next(unauthorized("No token provided"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return next(unauthorized("User no longer exists"));

    req.user = user;
    next();
  } catch (err) {
    next(unauthorized("Invalid or expired token"));
  }
};
