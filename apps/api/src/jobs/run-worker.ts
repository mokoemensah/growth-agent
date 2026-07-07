#!/usr/bin/env tsx
/**
 * Job worker — polls Postgres job queue and runs the daily loop.
 *
 * Usage:
 *   MOCK_INTEGRATIONS=true npm run jobs:run
 *   npm run jobs:run -- --once lead_gen
 *   npm run jobs:run -- --enqueue-today
 */

import { createDb } from "./db.js";
import {
  dispatchJob,
  enqueueDailyJobs,
  type JobType,
} from "./daily-loop.js";

const POLL_MS = Number(process.env.JOB_POLL_MS ?? 5_000);
const BATCH_SIZE = Number(process.env.JOB_BATCH_SIZE ?? 5);
const DEFAULT_CAMPAIGN_ID =
  process.env.DEFAULT_CAMPAIGN_ID ?? "11111111-1111-1111-1111-111111111111";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const args = process.argv.slice(2);

  if (args.includes("--enqueue-today")) {
    await enqueueDailyJobs(db, DEFAULT_CAMPAIGN_ID);
    console.log("Enqueued today's jobs");
  }

  const onceFlag = args.indexOf("--once");
  if (onceFlag !== -1) {
    const jobType = args[onceFlag + 1] as JobType | undefined;
    if (jobType) {
      await runSingleJob(db, jobType);
    } else {
      await runCycle(db);
    }
    await db.sql.end();
    return;
  }

  console.log(`Worker started (poll every ${POLL_MS}ms, mock=${process.env.MOCK_INTEGRATIONS ?? "false"})`);

  const shutdown = async () => {
    console.log("Shutting down...");
    await db.sql.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    await runCycle(db);
    await sleep(POLL_MS);
  }
}

async function runCycle(db: ReturnType<typeof createDb>): Promise<void> {
  const jobs = await db.jobs.fetchDue(BATCH_SIZE);
  if (jobs.length === 0) return;

  for (const job of jobs) {
    console.log(`[worker] Running ${job.jobType} (${job.id})`);
    try {
      await dispatchJob(db, {
        id: job.id,
        jobType: job.jobType as JobType,
        payload: job.payload,
        idempotencyKey: job.idempotencyKey ?? undefined,
      });
      console.log(`[worker] Completed ${job.jobType} (${job.id})`);
    } catch (err) {
      console.error(`[worker] Failed ${job.jobType} (${job.id}):`, err);
    }
  }
}

async function runSingleJob(db: ReturnType<typeof createDb>, jobType: JobType): Promise<void> {
  const payload = defaultPayload(jobType);
  const id = await db.jobs.enqueue({
    jobType,
    payload,
    scheduledFor: new Date(),
  });

  await dispatchJob(db, { id, jobType, payload });
}

function defaultPayload(jobType: JobType): unknown {
  switch (jobType) {
    case "lead_gen":
      return {
        campaignId: DEFAULT_CAMPAIGN_ID,
        targetCount: 3,
        icpFilter: {},
      };
    case "score_leads":
      return { campaignId: DEFAULT_CAMPAIGN_ID, minScore: 60 };
    case "outreach":
      return {
        campaignId: DEFAULT_CAMPAIGN_ID,
        batchSize: 5,
        dryRun: process.env.MOCK_INTEGRATIONS === "true",
      };
    case "reply_triage":
      return {
        since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        limit: 50,
      };
    case "daily_report":
      return {
        channel: "telegram",
        recipientId: process.env.OWNER_TELEGRAM_ID ?? "",
      };
    case "learning_weekly":
      return {};
    default: {
      const _exhaustive: never = jobType;
      return _exhaustive;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
