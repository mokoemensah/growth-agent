import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb } from "./db-singleton.js";
import { handleResendWebhook, type ResendWebhookEvent } from "./jobs/integrations.js";
import { handleSignup } from "../../../packages/actions/handle-signup.js";
import { isOutreachPaused, setOutreachPaused } from "../../../packages/system-state/index.js";
import { pollJobs, runDailyCron, runReplyTriageCron } from "./worker.js";

function verifyCronAuth(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = c.req.header("authorization");
  return auth === `Bearer ${secret}`;
}

export function createApp(): Hono {
  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/health", async (c) => {
    try {
      const db = getDb();
      await db.sql`SELECT 1`;
      const paused = await isOutreachPaused(db);
      return c.json({
        ok: true,
        outreachPaused: paused,
        mock: process.env.MOCK_INTEGRATIONS === "true",
        runtime: process.env.VERCEL ? "vercel" : "node",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 503);
    }
  });

  app.post("/webhooks/resend", async (c) => {
    const db = getDb();
    const event = (await c.req.json()) as ResendWebhookEvent;
    await handleResendWebhook(db, event);
    return c.json({ received: true });
  });

  app.post("/api/signup", async (c) => {
    const db = getDb();
    const body = (await c.req.json()) as {
      email?: string;
      name?: string;
      company?: string;
      utm?: Record<string, string>;
    };
    if (!body.email) {
      return c.json({ error: "email required" }, 400);
    }
    const result = await handleSignup(db, {
      email: body.email,
      name: body.name,
      company: body.company,
      utm: body.utm ?? {},
    });
    return c.json(result);
  });

  app.get("/api/system/status", async (c) => {
    const db = getDb();
    const paused = await isOutreachPaused(db);
    const [jobs] = await db.sql<{ pending: string }[]>`
      SELECT COUNT(*)::text AS pending FROM jobs WHERE status = 'pending'
    `;
    return c.json({
      outreachPaused: paused,
      pendingJobs: Number(jobs?.pending ?? 0),
    });
  });

  app.post("/api/system/kill-switch", async (c) => {
    const db = getDb();
    const apiKey = c.req.header("x-api-key");
    if (process.env.WORKER_API_KEY && apiKey !== process.env.WORKER_API_KEY) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const { paused } = (await c.req.json()) as { paused?: boolean };
    if (typeof paused !== "boolean") {
      return c.json({ error: "paused boolean required" }, 400);
    }
    await setOutreachPaused(db, paused);
    return c.json({ outreachPaused: paused });
  });

  // Hobby plan allows one daily cron, so this also triages replies and
  // drains the job queue in the same invocation.
  app.get("/api/cron/daily", async (c) => {
    if (!verifyCronAuth(c)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const db = getDb();
    await runDailyCron(db);
    await runReplyTriageCron(db);
    let processed = 0;
    for (let i = 0; i < 10; i++) {
      const result = await pollJobs(db);
      processed += result.processed;
      if (result.processed === 0) break;
    }
    return c.json({ ok: true, task: "daily", processed });
  });

  app.get("/api/cron/reply-triage", async (c) => {
    if (!verifyCronAuth(c)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const db = getDb();
    await runReplyTriageCron(db);
    return c.json({ ok: true, task: "reply_triage" });
  });

  app.get("/api/cron/poll-jobs", async (c) => {
    if (!verifyCronAuth(c)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const db = getDb();
    const result = await pollJobs(db);
    return c.json({ ok: true, ...result });
  });

  return app;
}
