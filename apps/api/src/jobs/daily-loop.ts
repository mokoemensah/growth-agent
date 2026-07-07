/**
 * Daily growth loop — LeadGen → Score → Outreach → Reply triage
 *
 * Schedule (UTC):
 *   06:00  leadGenJob
 *   06:30  scoreLeadsJob
 *   08:00  outreachJob
 *   every 30 min (08:00-20:00)  replyTriageJob
 *   20:30  dailyReportJob
 *
 * Wire this to Inngest, BullMQ, or node-cron. Example uses a simple dispatcher.
 */

import { randomUUID } from "node:crypto";
import type {
  CopywriterInput,
  LeadGenJobPayload,
  LeadScorerInput,
  OutreachJobPayload,
  ReplyClassifierInput,
  ReplyTriageJobPayload,
  ResearcherInput,
  ScoreLeadsJobPayload,
} from "../../../../packages/schemas/index.js";
import {
  CopywriterOutputSchema,
  LeadScorerOutputSchema,
  ReplyClassifierOutputSchema,
  ResearcherOutputSchema,
} from "../../../../packages/schemas/index.js";
import { checkPolicy } from "../../../../packages/policies/index.js";
import {
  routeLeadToProduct,
  type ProductRecord,
} from "../../../../packages/product-router/index.js";
import { routerWeightFromMetadata } from "../../../../packages/learning/index.js";
import { isOutreachPaused } from "../../../../packages/system-state/index.js";
import { runAgent } from "./agent-runner.js";
import { incrementDailyEmailCounter, type Db } from "./db.js";
import {
  enrichCompany,
  fetchInboundRepliesFromDb,
  sendEmail,
} from "./integrations.js";
import { notify } from "./notify.js";
import {
  ensureSubjectLineExperiment,
  pickSubjectVariant,
  recordReplyConversion,
  recordVariantImpression,
  runWeeklyLearning,
} from "../../../../packages/learning/index.js";

// ---------------------------------------------------------------------------
// Job dispatcher
// ---------------------------------------------------------------------------

export type JobType =
  | "lead_gen"
  | "score_leads"
  | "outreach"
  | "reply_triage"
  | "daily_report"
  | "learning_weekly";

export interface JobRecord {
  id: string;
  jobType: JobType;
  payload: unknown;
  idempotencyKey?: string;
}

export async function dispatchJob(db: Db, job: JobRecord): Promise<void> {
  await db.jobs.markRunning(job.id);

  try {
    switch (job.jobType) {
      case "lead_gen":
        await leadGenJob(db, job.payload as LeadGenJobPayload, job.id);
        break;
      case "score_leads":
        await scoreLeadsJob(db, job.payload as ScoreLeadsJobPayload, job.id);
        break;
      case "outreach":
        await outreachJob(db, job.payload as OutreachJobPayload, job.id);
        break;
      case "reply_triage":
        await replyTriageJob(db, job.payload as ReplyTriageJobPayload, job.id);
        break;
      case "daily_report":
        await dailyReportJob(db, job.payload as { channel: string; recipientId: string }, job.id);
        break;
      case "learning_weekly":
        await learningWeeklyJob(db, job.id);
        break;
      default: {
        const _exhaustive: never = job.jobType;
        throw new Error(`Unknown job type: ${_exhaustive}`);
      }
    }
    await db.jobs.markCompleted(job.id);
  } catch (err) {
    await db.jobs.markFailed(job.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 06:00 — Lead generation
// ---------------------------------------------------------------------------

export async function leadGenJob(
  db: Db,
  payload: LeadGenJobPayload,
  jobId: string,
): Promise<void> {
  const { campaignId, targetCount, icpFilter } = payload;

  // 1. Pull prospects from enrichment provider (Apollo, Clay, etc.)
  const prospects = await enrichCompany.searchProspects(icpFilter, targetCount);

  for (const prospect of prospects) {
    // Skip known domains / suppression
    if (await db.suppression.hasDomain(prospect.domain)) continue;

    // 2. Upsert company
    const company = await db.companies.upsertByDomain({
      name: prospect.companyName,
      domain: prospect.domain,
      industry: prospect.industry,
      employeeCount: prospect.employeeCount,
      country: prospect.country,
      source: "apollo",
      sourceRef: prospect.externalId,
    });

    // 3. Researcher agent — structured company brief
    const researcherInput: ResearcherInput = {
      agentId: "researcher",
      companyId: company.id,
      domain: prospect.domain,
      companyName: prospect.companyName,
      jobId,
    };
    const research = ResearcherOutputSchema.parse(await runAgent(db, researcherInput));

    await db.companies.update(company.id, {
      description: research.description,
      linkedinUrl: research.linkedinUrl,
      industry: research.industry ?? company.industry,
      employeeCount: research.employeeCount ?? company.employeeCount,
      metadata: { recentSignals: research.recentSignals, techStack: research.techStack },
    });

    // 4. Upsert primary contact
    if (prospect.contactEmail) {
      await db.contacts.upsertByEmail({
        companyId: company.id,
        email: prospect.contactEmail,
        firstName: prospect.contactFirstName,
        lastName: prospect.contactLastName,
        title: prospect.contactTitle,
        status: "enriched",
      });
    }

    await db.activities.create({
      companyId: company.id,
      type: "lead_discovered",
      agentId: "orchestrator",
      jobId,
      metadata: { campaignId, source: "lead_gen" },
    });
  }
}

// ---------------------------------------------------------------------------
// 06:30 — Score leads
// ---------------------------------------------------------------------------

export async function scoreLeadsJob(
  db: Db,
  payload: ScoreLeadsJobPayload,
  jobId: string,
): Promise<void> {
  const { campaignId, minScore } = payload;
  const activeProducts = await db.products.listActive();
  const productRecords: ProductRecord[] = activeProducts.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    repo: p.repo,
    description: p.description,
    status: p.status,
    landingPath: p.landingPath,
    priceCents: p.priceCents,
    billing: p.billing,
    icpRules: p.icpRules as ProductRecord["icpRules"],
    routerWeight: routerWeightFromMetadata(p.metadata),
  }));

  const companies = payload.companyIds
    ? await db.companies.findByIds(payload.companyIds)
    : await db.companies.findUnscored({ limit: 50 });

  for (const company of companies) {
    const contacts = await db.contacts.findByCompany(company.id);
    const primaryContact = contacts[0];

    const route = routeLeadToProduct(
      {
        industry: company.industry,
        employeeCount: company.employeeCount,
        contactTitle: primaryContact?.title ?? null,
        companyName: company.name,
        domain: company.domain,
        description: company.description,
      },
      productRecords,
    );

    if (!route) {
      await db.companies.update(company.id, {
        icpScore: 0,
        icpReason: "No active product match",
        disqualified: true,
        disqualifyReason: "No product fit above threshold",
      });
      if (primaryContact) {
        await db.contacts.update(primaryContact.id, { status: "disqualified" });
      }
      await db.activities.create({
        companyId: company.id,
        contactId: primaryContact?.id,
        type: "score",
        agentId: "product_router",
        jobId,
        metadata: { action: "skip", reason: "no_product_match" },
      });
      continue;
    }

    const { product, score: routeScore, reasons: routeReasons } = route;

    const scorerInput: LeadScorerInput = {
      agentId: "lead_scorer",
      companyId: company.id,
      contactId: primaryContact?.id,
      productSlug: product.slug,
      icpDocVersion: "1.0",
      jobId,
    };
    const score = LeadScorerOutputSchema.parse(await runAgent(db, scorerInput));

    const combinedReasons = [...routeReasons, ...score.reasons].slice(0, 5);

    await db.companies.update(company.id, {
      icpScore: Math.max(score.companyScore, routeScore),
      icpReason: combinedReasons.join("; "),
      disqualified: score.disqualify,
      disqualifyReason: score.disqualifyReason,
      metadata: { assignedProductSlug: product.slug },
    });

    if (primaryContact) {
      await db.contacts.update(primaryContact.id, {
        leadScore: score.contactScore ?? score.companyScore,
        leadScoreReason: combinedReasons.join("; "),
        productId: product.id,
        status: score.disqualify ? "disqualified" : "scored",
      });
    }

    await db.activities.create({
      companyId: company.id,
      contactId: primaryContact?.id,
      productId: product.id,
      type: "score",
      agentId: "lead_scorer",
      jobId,
      metadata: {
        score: score.companyScore,
        routeScore,
        fit: score.fit,
        action: score.recommendedAction,
        productSlug: product.slug,
      },
    });

    const targetCampaign =
      (await db.campaigns.getByProductId(product.id)) ??
      (campaignId ? await db.campaigns.get(campaignId) : null);

    if (
      targetCampaign &&
      score.recommendedAction === "enroll_outreach" &&
      score.companyScore >= minScore &&
      primaryContact
    ) {
      await db.campaignContacts.enroll(targetCampaign.id, primaryContact.id);
      await db.contacts.update(primaryContact.id, { status: "queued" });
    }
  }
}

// ---------------------------------------------------------------------------
// 08:00 — Outreach batch
// ---------------------------------------------------------------------------

export async function outreachJob(
  db: Db,
  payload: OutreachJobPayload,
  jobId: string,
): Promise<void> {
  const { campaignId, batchSize, dryRun, contactIds } = payload;

  if (await isOutreachPaused(db)) {
    await db.activities.create({
      campaignId,
      type: "policy_blocked",
      agentId: "orchestrator",
      jobId,
      metadata: { reason: "Outreach paused via kill switch" },
    });
    return;
  }

  const campaign = await db.campaigns.get(campaignId);

  if (campaign.status !== "active") {
    return;
  }

  const ctx = await db.policy.getContext();
  const contacts = contactIds?.length
    ? await db.contacts.findQueuedByIds(campaignId, contactIds)
    : await db.contacts.findQueuedForCampaign(campaignId, batchSize);

  for (const contact of contacts) {
    const isSuppressed = await db.suppression.hasDomain(contact.email.split("@")[1] ?? "");
    const contactCtx = {
      ...ctx,
      isSuppressed,
      isUnsubscribed: contact.status === "unsubscribed",
      isDoNotContact: contact.doNotContact,
    };

    const policy = checkPolicy(
      { action: "send_email", contactId: contact.id, campaignId, metadata: {} },
      contactCtx,
    );

    if (policy.decision === "deny") {
      await db.activities.create({
        contactId: contact.id,
        campaignId,
        type: "policy_blocked",
        agentId: "orchestrator",
        jobId,
        metadata: { reason: policy.reason },
      });
      continue;
    }

    if (policy.decision === "escalate") {
      await db.approvals.create({
        action: "send_email",
        agentId: "orchestrator",
        contactId: contact.id,
        payload: { campaignId, contactId: contact.id },
        reason: policy.reason,
      });
      continue;
    }

    const enrollment = await db.campaignContacts.get(campaignId, contact.id);
    const sequence = await db.sequences.getStep(campaignId, enrollment.sequenceStep);

    let productSlug: string | undefined;
    if (contact.productId) {
      const product = await db.products.get(contact.productId);
      productSlug = product.slug;
    }

    const copyInput: CopywriterInput = {
      agentId: "copywriter",
      contactId: contact.id,
      campaignId,
      productSlug,
      sequenceStep: enrollment.sequenceStep,
      channel: "email",
      playbookId: campaign.playbookId,
      priorMessages: [],
      jobId,
    };
    const draft = CopywriterOutputSchema.parse(await runAgent(db, copyInput));

    const experimentId = await ensureSubjectLineExperiment(
      db,
      campaignId,
      draft.subject ?? sequence.subjectTemplate,
    );
    const variant = await pickSubjectVariant(db, experimentId);
    const subject = variant?.subject ?? draft.subject ?? sequence.subjectTemplate;

    if (draft.requiresApproval) {
      await db.approvals.create({
        action: "send_email",
        agentId: "copywriter",
        contactId: contact.id,
        payload: { subject: draft.subject, body: draft.bodyText, reason: draft.approvalReason },
        reason: draft.approvalReason ?? "Copywriter flagged for review",
      });
      continue;
    }

    if (dryRun) {
      await db.activities.create({
        contactId: contact.id,
        campaignId,
        type: "email_drafted",
        subject: draft.subject,
        body: draft.bodyText,
        agentId: "copywriter",
        jobId,
        metadata: { dryRun: true },
      });
      continue;
    }

    const sent = await sendEmail({
      to: contact.email,
      subject,
      text: draft.bodyText,
      html: draft.bodyHtml,
      tags: { campaignId, contactId: contact.id },
    });

    if (variant) {
      await recordVariantImpression(db, variant.id);
    }

    await db.emailMessages.create({
      contactId: contact.id,
      campaignId,
      sequenceStep: enrollment.sequenceStep,
      direction: "outbound",
      subject,
      bodyText: draft.bodyText,
      providerId: sent.messageId,
      variantId: variant?.id,
    });

    await db.contacts.update(contact.id, {
      status: "contacted",
      lastContactedAt: new Date(),
    });

    await db.campaignContacts.advanceStep(campaignId, contact.id);
    await db.campaigns.incrementSent(campaignId);

    await db.activities.create({
      contactId: contact.id,
      campaignId,
      type: "email_sent",
      subject,
      body: draft.bodyText,
      externalId: sent.messageId,
      agentId: "orchestrator",
      jobId,
      metadata: variant ? { experimentVariantId: variant.id, variantLabel: variant.label } : {},
    });

    await incrementDailyEmailCounter(db);
    ctx.emailsSentToday += 1;
  }
}

// ---------------------------------------------------------------------------
// Every 30 min — Reply triage
// ---------------------------------------------------------------------------

export async function replyTriageJob(
  db: Db,
  payload: ReplyTriageJobPayload,
  jobId: string,
): Promise<void> {
  const replies = await fetchInboundRepliesFromDb(db, new Date(payload.since), payload.limit);

  for (const reply of replies) {
    const contact = await db.contacts.findByEmail(reply.fromEmail);
    if (!contact) continue;

    const existing = await db.emailMessages.findByProviderId(reply.providerId);
    if (existing) continue;

    const inbound = await db.emailMessages.create({
      contactId: contact.id,
      direction: "inbound",
      subject: reply.subject,
      bodyText: reply.bodyText,
      providerId: reply.providerId,
      threadId: reply.threadId,
      repliedAt: new Date(),
    });

    const thread = await db.emailMessages.findThread(reply.threadId);

    const classifyInput: ReplyClassifierInput = {
      agentId: "reply_classifier",
      contactId: contact.id,
      emailMessageId: inbound.id,
      inboundSubject: reply.subject,
      inboundBody: reply.bodyText,
      threadHistory: thread.map((m) => ({
        direction: m.direction as "outbound" | "inbound",
        body: m.bodyText,
      })),
      jobId,
    };
    const classification = ReplyClassifierOutputSchema.parse(
      await runAgent(db, classifyInput),
    );

    await db.activities.create({
      contactId: contact.id,
      type: "email_replied",
      agentId: "reply_classifier",
      jobId,
      metadata: {
        classification: classification.classification,
        nextAction: classification.suggestedNextAction,
        urgency: classification.urgency,
      },
    });

    await recordReplyConversion(db, contact.id);

    switch (classification.suggestedNextAction) {
      case "suppress":
        await db.suppression.add(contact.email, "unsubscribe_reply");
        await db.contacts.update(contact.id, {
          status: "unsubscribed",
          doNotContact: true,
          unsubscribedAt: new Date(),
        });
        break;

      case "book_meeting":
        await db.contacts.update(contact.id, { status: "interested" });
        await notify.hotLead({
          contactId: contact.id,
          summary: classification.summary,
          bookingUrl: process.env.CALCOM_BOOKING_URL,
        });
        break;

      case "escalate_to_human":
        await db.approvals.create({
          action: "send_email",
          agentId: "reply_classifier",
          contactId: contact.id,
          payload: {
            classification,
            suggestedReply: classification.suggestedReply,
          },
          reason: `High-urgency reply: ${classification.summary}`,
        });
        break;

      case "send_follow_up":
        if (classification.suggestedReply) {
          await db.jobs.enqueue({
            jobType: "outreach",
            payload: {
              campaignId: reply.campaignId,
              batchSize: 1,
              dryRun: false,
              _followUpReply: classification.suggestedReply,
            },
            scheduledFor: new Date(Date.now() + 5 * 60_000),
          });
        }
        await db.contacts.update(contact.id, { status: "replied" });
        break;

      case "mark_lost":
        await db.contacts.update(contact.id, { status: "lost" });
        break;

      case "add_to_nurture":
        await db.contacts.update(contact.id, { status: "not_now" });
        break;

      case "no_action":
        await db.contacts.update(contact.id, { status: "replied" });
        break;
    }

    await db.inboundQueue.markProcessed(reply.providerId);
  }
}

// ---------------------------------------------------------------------------
// Weekly — Self-learning loop (strategist + CAC + router weights + A/B winners)
// ---------------------------------------------------------------------------

export async function learningWeeklyJob(db: Db, jobId: string): Promise<void> {
  const result = await runWeeklyLearning(db, jobId);
  console.log(
    `[learning] CAC:${result.cacProductsUpdated} router:${result.routerWeightsUpdated} experiments:${result.experimentsPromoted}`,
  );
}

// ---------------------------------------------------------------------------
// 20:30 — Daily report
// ---------------------------------------------------------------------------

export async function dailyReportJob(
  db: Db,
  payload: { channel: string; recipientId: string },
  jobId: string,
): Promise<void> {
  const metrics = await db.metrics.getDaily(new Date());
  const pendingApprovals = await db.approvals.countPending();
  const pipeline = await db.metrics.getPipelineSummary();

  const report = [
    "📊 Daily Growth Report",
    "",
    `Emails sent: ${metrics.emailsSent}`,
    `Replies: ${metrics.replies}`,
    `Meetings booked: ${metrics.meetingsBooked}`,
    `Policy blocks: ${metrics.policyBlocks}`,
    `Spend: $${metrics.costUsd.toFixed(2)}`,
    "",
    "Pipeline:",
    ...pipeline.map((p) => `  ${p.status}: ${p.count}`),
    "",
    pendingApprovals > 0
      ? `⚠️ ${pendingApprovals} approvals pending`
      : "✅ No pending approvals",
  ].join("\n");

  await notify.send(payload.channel, payload.recipientId, report);

  await db.activities.create({
    type: "note",
    agentId: "orchestrator",
    jobId,
    body: report,
    metadata: { reportType: "daily" },
  });
}

// ---------------------------------------------------------------------------
// Cron registration (node-cron example)
// ---------------------------------------------------------------------------

export const DAILY_CRON_SCHEDULE = {
  leadGen: "0 6 * * *",
  scoreLeads: "30 6 * * *",
  outreach: "0 8 * * *",
  replyTriage: "*/30 8-20 * * *",
  dailyReport: "30 20 * * *",
  learningWeekly: "0 7 * * 0",
} as const;

export async function enqueueDailyJobs(db: Db, campaignId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await db.jobs.enqueue({
    jobType: "lead_gen",
    idempotencyKey: `lead_gen:${today}`,
    payload: { campaignId, targetCount: 20, icpFilter: {} },
    scheduledFor: cronNext(DAILY_CRON_SCHEDULE.leadGen),
  });

  await db.jobs.enqueue({
    jobType: "score_leads",
    idempotencyKey: `score_leads:${today}`,
    payload: { campaignId, minScore: 60 },
    scheduledFor: cronNext(DAILY_CRON_SCHEDULE.scoreLeads),
  });

  const activeCampaigns = await db.campaigns.listActive();
  for (const campaign of activeCampaigns) {
    await db.jobs.enqueue({
      jobType: "outreach",
      idempotencyKey: `outreach:${today}:${campaign.slug}`,
      payload: { campaignId: campaign.id, batchSize: 10, dryRun: false },
      scheduledFor: cronNext(DAILY_CRON_SCHEDULE.outreach),
    });
  }

  await db.jobs.enqueue({
    jobType: "daily_report",
    idempotencyKey: `daily_report:${today}`,
    payload: { channel: "telegram", recipientId: process.env.OWNER_TELEGRAM_ID ?? "" },
    scheduledFor: cronNext(DAILY_CRON_SCHEDULE.dailyReport),
  });

  if (new Date().getUTCDay() === 0) {
    const week = today.slice(0, 7);
    await db.jobs.enqueue({
      jobType: "learning_weekly",
      idempotencyKey: `learning_weekly:${week}`,
      payload: {},
      scheduledFor: cronNext(DAILY_CRON_SCHEDULE.learningWeekly),
    });
  }
}

function cronNext(_expr: string): Date {
  // Replace with cron-parser in production
  return new Date();
}

export function createIdempotencyKey(jobType: JobType, suffix: string): string {
  return `${jobType}:${suffix}:${randomUUID().slice(0, 8)}`;
}
