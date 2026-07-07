import { config } from "dotenv";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import cron from "node-cron";
import { createApp } from "./app.js";
import { getDb } from "./db-singleton.js";
import { pollJobs, runDailyCron, runReplyTriageCron, runWeeklyLearningCron } from "./worker.js";

config({ path: resolve(process.cwd(), ".env") });

const PORT = Number(process.env.PORT ?? 3456);
const POLL_MS = Number(process.env.JOB_POLL_MS ?? 5_000);
const CRON_ENABLED = process.env.CRON_ENABLED !== "false";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = getDb();
const app = createApp();

function startCron(): void {
  if (!CRON_ENABLED) return;

  const tz = "UTC";
  cron.schedule("0 6 * * *", () => void runDailyCron(db), { timezone: tz });
  cron.schedule("0 7 * * 0", () => void runWeeklyLearningCron(db), { timezone: tz });
  cron.schedule("*/30 8-20 * * *", () => void runReplyTriageCron(db), { timezone: tz });

  console.log("[cron] Daily loop + weekly learning + reply triage scheduled (UTC)");
}

startCron();
setInterval(() => void pollJobs(db), POLL_MS);

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log(`[api] listening on http://0.0.0.0:${PORT}`);
  console.log(`[api] health → /health | webhook → /webhooks/resend`);
});

process.on("SIGTERM", async () => {
  await db.sql.end();
  process.exit(0);
});
