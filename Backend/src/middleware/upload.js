import multer from "multer";
import { mkdirSync } from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { badRequest } from "../utils/ApiError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, "../../uploads/profile");
mkdirSync(UPLOAD_DIR, { recursive: true });

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const unique = `${req.user._id}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  if (!ACCEPTED_TYPES.includes(file.mimetype)) {
    return cb(badRequest("Avatar must be a JPEG, PNG, or WEBP image"));
  }
  cb(null, true);
};

export const uploadAvatar = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_BYTES },
}).single("avatar");
