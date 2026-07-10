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
  ReplyClassifierOutput,
  ReplyTriageJobPayload,
  ResearcherInput,
  ScoreLeadsJobPayload,
} from "../../../../packages/schemas/index.js";
import { checkPolicy } from "../../../../packages/policies/index.js";
import {
  routeLeadToProduct,
  type ProductRecord,
} from "../../../../packages/product-router/index.js";
import { routerWeightFromMetadata } from "../../../../packages/learning/index.js";
import { getHeroIcpFilter } from "../../../../packages/hero-config/index.js";
import { getDailySendCap, getOutreachMode, isOutreachPaused } from "../../../../packages/system-state/index.js";
import { triggerOutreach } from "../../../../packages/actions/trigger-outreach.js";
import { runAgent } from "./agent-runner.js";
import { incrementDailyEmailCounter, type Db } from "./db.js";
import {
  enrichCompany,
  fetchInboundRepliesFromDb,
  sendEmail,
} from "./integrations.js";
import { notify } from "./notify.js";
import {
  applySubjectVariant,
  ensureSubjectLineExperiment,
  pickSubjectVariant,
  recordReplyConversion,
  recordVariantImpression,
  runWeeklyLearning,
} from "../../../../packages/learning/index.js";
import { buildEmailFooter } from "../../../../packages/vapi/demo-lines.js";
import { warmFollowUpCall } from "../../../../packages/vapi/warm-call.js";
import type { Company, Contact } from "./types.js";

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
    const research = await runAgent(db, researcherInput);

    await db.companies.update(company.id, {
      description: research.description,
      linkedinUrl: research.linkedinUrl,
      industry: research.industry ?? company.industry,
      employeeCount: research.employeeCount ?? company.employeeCount,
      metadata: {
        recentSignals: research.recentSignals,
        techStack: research.techStack,
        city: prospect.city ?? company.metadata.city,
        state: prospect.state ?? company.metadata.state,
        searchCity: prospect.searchCity ?? company.metadata.searchCity,
        address: prospect.address ?? company.metadata.address,
      },
    });

    // 4. Upsert primary contact
    if (prospect.contactEmail) {
      await db.contacts.upsertByEmail({
        companyId: company.id,
        email: prospect.contactEmail,
        firstName: prospect.contactFirstName,
        lastName: prospect.contactLastName,
        title: prospect.contactTitle,
        phone: prospect.contactPhone ?? null,
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
    const score = await runAgent(db, scorerInput);

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

  const outreachMode = await getOutreachMode(db);
  if (outreachMode === "triggered" && !payload.trigger) {
    await db.activities.create({
      campaignId,
      type: "policy_blocked",
      agentId: "orchestrator",
      jobId,
      metadata: { reason: "Outreach mode is triggered — waiting for explicit trigger" },
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
    const draft = await runAgent(db, copyInput);

    const draftSubject = draft.subject ?? sequence.subjectTemplate;
    const experimentId = await ensureSubjectLineExperiment(db, campaignId, draftSubject);
    const variant = await pickSubjectVariant(db, experimentId);
    // Apply the variant's *style* to this contact's own subject — never reuse
    // the stored subject text, which was written for a different company.
    const subject = variant ? applySubjectVariant(variant.label, draftSubject) : draftSubject;

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

    const company = await db.companies.get(contact.companyId);
    const geo = companyGeo(company);
    const footer = await buildEmailFooter(geo);
    const bodyText = `${draft.bodyText ?? ""}${footer.text}`;
    const bodyHtml = draft.bodyHtml ? `${draft.bodyHtml}${footer.html}` : undefined;

    const sent = await sendEmail({
      to: contact.email,
      subject,
      text: bodyText,
      html: bodyHtml,
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
      bodyText,
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
      body: bodyText,
      externalId: sent.messageId,
      agentId: "orchestrator",
      jobId,
      metadata: {
        ...(variant ? { experimentVariantId: variant.id, variantLabel: variant.label } : {}),
        demoLine: footer.demoLine.number,
      },
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
    const inbound =
      existing ??
      (await db.emailMessages.create({
        contactId: contact.id,
        direction: "inbound",
        subject: reply.subject,
        bodyText: reply.bodyText,
        providerId: reply.providerId,
        threadId: reply.threadId,
        repliedAt: new Date(),
      }));

    const thread = await db.emailMessages.findThread(reply.threadId ?? inbound.threadId);

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
    const classification = (await runAgent(
      db,
      classifyInput,
    )) as ReplyClassifierOutput;

    await db.activities.create({
      contactId: contact.id,
      type: "email_replied",
      subject: reply.subject,
      body: reply.bodyText,
      agentId: "reply_classifier",
      jobId,
      metadata: {
        classification: classification.classification,
        nextAction: classification.suggestedNextAction,
        urgency: classification.urgency,
      },
    });

    await recordReplyConversion(db, contact.id);

    const repliedAt = new Date();
    const company = await db.companies.get(contact.companyId);
    const geo = companyGeo(company);

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
        await db.contacts.update(contact.id, {
          status: "interested",
          lastRepliedAt: repliedAt,
        });
        await notify.hotLead({
          contactId: contact.id,
          summary: classification.summary,
          bookingUrl: process.env.CALCOM_BOOKING_URL,
        });
        await maybeWarmFollowUpCall(db, {
          contact,
          company,
          geo,
          campaignId: reply.campaignId,
          jobId,
          summary: classification.summary,
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
          await triggerOutreach(db, {
            source: "reply_follow_up",
            batchSize: 1,
            contactIds: [contact.id],
            campaignId: reply.campaignId ?? undefined,
            triggerId: inbound.id,
            note: classification.summary,
          });
        }
        await db.contacts.update(contact.id, { status: "replied", lastRepliedAt: repliedAt });
        break;

      case "mark_lost":
        await db.contacts.update(contact.id, { status: "lost", lastRepliedAt: repliedAt });
        break;

      case "add_to_nurture":
        await db.contacts.update(contact.id, { status: "not_now", lastRepliedAt: repliedAt });
        break;

      case "no_action":
        await db.contacts.update(contact.id, { status: "replied", lastRepliedAt: repliedAt });
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
  const icpFilter = getHeroIcpFilter();
  const sendCap = await getDailySendCap(db);

  await db.jobs.enqueue({
    jobType: "lead_gen",
    idempotencyKey: `lead_gen:${today}`,
    payload: { campaignId, targetCount: 20, icpFilter },
    scheduledFor: cronNext(DAILY_CRON_SCHEDULE.leadGen),
  });

  await db.jobs.enqueue({
    jobType: "score_leads",
    idempotencyKey: `score_leads:${today}`,
    payload: { campaignId, minScore: 60 },
    scheduledFor: cronNext(DAILY_CRON_SCHEDULE.scoreLeads),
  });

  const activeCampaigns = await db.campaigns.listActive();
  const outreachMode = await getOutreachMode(db);

  if (outreachMode === "automatic") {
    for (const campaign of activeCampaigns) {
      await db.jobs.enqueue({
        jobType: "outreach",
        idempotencyKey: `outreach:${today}:${campaign.slug}`,
        payload: {
          campaignId: campaign.id,
          batchSize: sendCap,
          dryRun: false,
          trigger: { source: "cron", id: today },
        },
        scheduledFor: cronNext(DAILY_CRON_SCHEDULE.outreach),
      });
    }
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

function companyGeo(company: Company): { state?: string | null; searchCity?: string | null } {
  const meta = company.metadata;
  return {
    state: typeof meta.state === "string" ? meta.state : null,
    searchCity: typeof meta.searchCity === "string" ? meta.searchCity : null,
  };
}

async function maybeWarmFollowUpCall(
  db: Db,
  input: {
    contact: Contact;
    company: Company;
    geo: { state?: string | null; searchCity?: string | null };
    campaignId: string | null;
    jobId: string;
    summary?: string;
  },
): Promise<void> {
  const alreadyCalled = input.contact.metadata.vapiWarmCallAt;
  if (alreadyCalled || !input.contact.phone || input.contact.doNotContact) {
    return;
  }

  const result = await warmFollowUpCall({
    contactId: input.contact.id,
    campaignId: input.campaignId,
    phone: input.contact.phone,
    contactName: input.contact.firstName,
    companyName: input.company.name,
    state: input.geo.state,
    searchCity: input.geo.searchCity,
    summary: input.summary,
  });

  if (!result.placed) return;

  await db.contacts.update(input.contact.id, {
    metadata: {
      vapiWarmCallAt: new Date().toISOString(),
      vapiCallId: result.callId,
      vapiFromNumber: result.demoLine?.number,
    },
  });

  await db.activities.create({
    contactId: input.contact.id,
    companyId: input.company.id,
    campaignId: input.campaignId ?? undefined,
    type: "meeting_proposed",
    agentId: "orchestrator",
    jobId: input.jobId,
    externalId: result.callId,
    metadata: {
      channel: "voice",
      fromNumber: result.demoLine?.number,
      reason: "warm_reply_book_meeting",
    },
  });
}

function cronNext(_expr: string): Date {
  // Replace with cron-parser in production
  return new Date();
}

export function createIdempotencyKey(jobType: JobType, suffix: string): string {
  return `${jobType}:${suffix}:${randomUUID().slice(0, 8)}`;
}
