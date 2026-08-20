import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import routes from "./routes/index.js";
import errorHandler from "./middleware/errorHandler.js";
import { CREDITS_PER_HOUR, SERVICE_CATEGORIES, TRANSPORT_MODES } from "./config/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Uploaded avatar images
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Health check
app.get("/api/v1/health", (req, res) => {
  res.json({ success: true, message: "STB-CT backend is running" });
});

// Public config so the frontend never hardcodes business constants
app.get("/api/v1/config", (req, res) => {
  res.json({
    success: true,
    data: {
      creditsPerHour: CREDITS_PER_HOUR,
      serviceCategories: SERVICE_CATEGORIES,
      transportModes: TRANSPORT_MODES,
    },
  });
});

app.use("/api/v1", routes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

app.use(errorHandler);

export default app;
