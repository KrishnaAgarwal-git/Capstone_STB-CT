import { unlink } from "fs/promises";
import path from "path";
import { UPLOAD_DIR } from "../middleware/upload.js";
import { asyncHandler, badRequest, ok } from "../utils/ApiError.js";

const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");

export const uploadUserAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest("No file uploaded");

  // Remove the previous avatar file if one exists, so uploads don't
  // accumulate orphaned files on disk.
  if (req.user.avatarUrl) {
    const oldFilename = req.user.avatarUrl.split("/uploads/profile/")[1];
    if (oldFilename) {
      await unlink(path.join(UPLOAD_DIR, oldFilename)).catch(() => {});
    }
  }

  req.user.avatarUrl = `${BACKEND_URL}/uploads/profile/${req.file.filename}`;
  await req.user.save();

  ok(res, { avatarUrl: req.user.avatarUrl }, "Avatar updated");
});

export const deleteUserAvatar = asyncHandler(async (req, res) => {
  if (req.user.avatarUrl) {
    const filename = req.user.avatarUrl.split("/uploads/profile/")[1];
    if (filename) {
      await unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
    }
  }
  req.user.avatarUrl = null;
  await req.user.save();

  ok(res, null, "Avatar removed");
});
