import dotenv from "dotenv";
dotenv.config({ override: true });

import { startWorkerServer } from "./server/worker";

// Start Standalone Worker Server
startWorkerServer().catch((err) => {
  console.error("Failed to start Worker Server:", err);
  process.exit(1);
});
