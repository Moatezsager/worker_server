import dotenv from "dotenv";
dotenv.config({ override: true });

import { startWorkerServer } from "../server/worker";

// ─── Entry Point for Standalone Worker Server ───
startWorkerServer().catch((err) => {
  console.error("❌ Fatal error in Worker Server:", err);
  process.exit(1);
});
