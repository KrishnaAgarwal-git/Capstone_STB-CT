import dotenv from "dotenv";
dotenv.config();

import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import { startScheduler } from "./src/services/timeBanking/confirmationTimeout.js";
import { registerGamificationListeners } from "./src/services/gamification/pointsService.js";

const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await connectDB();
    registerGamificationListeners();
    startScheduler();
    app.listen(PORT, () => {
      console.log(`STB-CT backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
};

start();
