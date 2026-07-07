import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const UuidSchema = z.string().uuid();
export const EmailSchema = z.string().email().toLowerCase();
export const DomainSchema = z.string().min(3).max(253);
export const AgentIdSchema = z.enum([
  "researcher",
  "lead_scorer",
  "copywriter",
  "reply_classifier",
  "qualifier",
  "strategist",
  "orchestrator",
]);

export const PolicyDecisionSchema = z.enum(["allow", "deny", "escalate"]);

export const IcpFilterSchema = z.object({
  industries: z.array(z.string()).optional(),
  minEmployees: z.number().int().positive().optional(),
  maxEmployees: z.number().int().positive().optional(),
  countries: z.array(z.string()).optional(),
  titles: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
});

export type IcpFilter = z.infer<typeof IcpFilterSchema>;

// ---------------------------------------------------------------------------
// Researcher
// ---------------------------------------------------------------------------

export const ResearcherInputSchema = z.object({
  agentId: z.literal("researcher"),
  companyId: UuidSchema.optional(),
  domain: DomainSchema,
  companyName: z.string().optional(),
  jobId: UuidSchema.optional(),
});

export const ResearcherOutputSchema = z.object({
  domain: DomainSchema,
  companyName: z.string(),
  industry: z.string().nullable(),
  employeeCount: z.number().int().nullable(),
  country: z.string().nullable(),
  description: z.string().max(2000),
  linkedinUrl: z.string().url().nullable(),
  techStack: z.array(z.string()).default([]),
  recentSignals: z.array(
    z.object({
      signal: z.string(),
      source: z.string(),
      observedAt: z.string().datetime().optional(),
    }),
  ).default([]),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).default([]),
});

export type ResearcherInput = z.infer<typeof ResearcherInputSchema>;
export type ResearcherOutput = z.infer<typeof ResearcherOutputSchema>;

// ---------------------------------------------------------------------------
// Lead Scorer
// ---------------------------------------------------------------------------

export const LeadScorerInputSchema = z.object({
  agentId: z.literal("lead_scorer"),
  companyId: UuidSchema,
  contactId: UuidSchema.optional(),
  productSlug: z.string().optional(),
  icpDocVersion: z.string().default("1.0"),
  researcherOutput: ResearcherOutputSchema.optional(),
  jobId: UuidSchema.optional(),
});

export const LeadScorerOutputSchema = z.object({
  companyScore: z.number().int().min(0).max(100),
  contactScore: z.number().int().min(0).max(100).optional(),
  fit: z.enum(["high", "medium", "low", "disqualified"]),
  reasons: z.array(z.string()).min(1).max(5),
  disqualify: z.boolean().default(false),
  disqualifyReason: z.string().optional(),
  recommendedAction: z.enum([
    "enroll_outreach",
    "nurture_only",
    "skip",
    "manual_review",
  ]),
  assignedProductSlug: z.string().optional(),
});

export type LeadScorerInput = z.infer<typeof LeadScorerInputSchema>;
export type LeadScorerOutput = z.infer<typeof LeadScorerOutputSchema>;

// ---------------------------------------------------------------------------
// Copywriter (outbound email / content)
// ---------------------------------------------------------------------------

export const CopywriterInputSchema = z.object({
  agentId: z.literal("copywriter"),
  contactId: UuidSchema,
  campaignId: UuidSchema,
  productSlug: z.string().optional(),
  sequenceStep: z.number().int().min(0),
  channel: z.enum(["email", "linkedin_dm", "blog_post", "social_post"]),
  playbookId: z.string(),
  variantLabel: z.string().optional(),
  priorMessages: z.array(
    z.object({
      direction: z.enum(["outbound", "inbound"]),
      subject: z.string().optional(),
      body: z.string(),
      sentAt: z.string().datetime(),
    }),
  ).default([]),
  jobId: UuidSchema.optional(),
});

export const CopywriterOutputSchema = z.object({
  subject: z.string().min(1).max(200).optional(),
  bodyText: z.string().min(50).max(5000),
  bodyHtml: z.string().optional(),
  personalizationTokens: z.record(z.string()).default({}),
  callToAction: z.string(),
  toneCheck: z.object({
    onBrand: z.boolean(),
    issues: z.array(z.string()).default([]),
  }),
  requiresApproval: z.boolean().default(false),
  approvalReason: z.string().optional(),
});

export type CopywriterInput = z.infer<typeof CopywriterInputSchema>;
export type CopywriterOutput = z.infer<typeof CopywriterOutputSchema>;

// ---------------------------------------------------------------------------
// Reply Classifier
// ---------------------------------------------------------------------------

export const ReplyClassifierInputSchema = z.object({
  agentId: z.literal("reply_classifier"),
  contactId: UuidSchema,
  emailMessageId: UuidSchema,
  inboundSubject: z.string(),
  inboundBody: z.string(),
  threadHistory: z.array(
    z.object({
      direction: z.enum(["outbound", "inbound"]),
      body: z.string(),
    }),
  ).default([]),
  jobId: UuidSchema.optional(),
});

export const ReplyClassifierOutputSchema = z.object({
  classification: z.enum([
    "interested",
    "question",
    "objection",
    "not_now",
    "referral",
    "unsubscribe",
    "auto_reply",
    "bounce",
    "spam",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string().max(500),
  extractedQuestions: z.array(z.string()).default([]),
  suggestedNextAction: z.enum([
    "book_meeting",
    "send_follow_up",
    "escalate_to_human",
    "add_to_nurture",
    "mark_lost",
    "suppress",
    "no_action",
  ]),
  suggestedReply: z.string().optional(),
  urgency: z.enum(["high", "medium", "low"]),
});

export type ReplyClassifierInput = z.infer<typeof ReplyClassifierInputSchema>;
export type ReplyClassifierOutput = z.infer<typeof ReplyClassifierOutputSchema>;

// ---------------------------------------------------------------------------
// Qualifier (pre-meeting / discovery)
// ---------------------------------------------------------------------------

export const QualifierInputSchema = z.object({
  agentId: z.literal("qualifier"),
  contactId: UuidSchema,
  threadHistory: z.array(
    z.object({
      direction: z.enum(["outbound", "inbound"]),
      body: z.string(),
      occurredAt: z.string().datetime(),
    }),
  ),
  researcherOutput: ResearcherOutputSchema.optional(),
  jobId: UuidSchema.optional(),
});

export const QualifierOutputSchema = z.object({
  bant: z.object({
    budget: z.enum(["confirmed", "likely", "unknown", "no_budget"]),
    authority: z.enum(["decision_maker", "influencer", "unknown"]),
    need: z.enum(["acute", "moderate", "exploratory", "none"]),
    timeline: z.enum(["immediate", "this_quarter", "later", "unknown"]),
  }),
  qualificationScore: z.number().int().min(0).max(100),
  qualified: z.boolean(),
  painPoints: z.array(z.string()).max(5),
  recommendedOfferId: z.string().optional(),
  discoveryQuestions: z.array(z.string()).max(5),
  meetingBrief: z.string().max(2000),
  redFlags: z.array(z.string()).default([]),
});

export type QualifierInput = z.infer<typeof QualifierInputSchema>;
export type QualifierOutput = z.infer<typeof QualifierOutputSchema>;

// ---------------------------------------------------------------------------
// Strategist (weekly optimization)
// ---------------------------------------------------------------------------

export const StrategistInputSchema = z.object({
  agentId: z.literal("strategist"),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  metrics: z.object({
    emailsSent: z.number().int(),
    openRate: z.number().min(0).max(1),
    replyRate: z.number().min(0).max(1),
    positiveReplyRate: z.number().min(0).max(1),
    meetingsBooked: z.number().int(),
    costUsd: z.number().nonnegative(),
    topVariants: z.array(
      z.object({
        label: z.string(),
        replyRate: z.number(),
      }),
    ).default([]),
  }),
  jobId: UuidSchema.optional(),
});

export const StrategistOutputSchema = z.object({
  summary: z.string().max(1000),
  wins: z.array(z.string()).max(5),
  losses: z.array(z.string()).max(5),
  recommendations: z.array(
    z.object({
      type: z.enum([
        "icp_change",
        "messaging_change",
        "channel_change",
        "cap_change",
        "pause_campaign",
        "new_experiment",
      ]),
      priority: z.enum(["high", "medium", "low"]),
      description: z.string(),
      requiresApproval: z.boolean(),
    }),
  ).max(10),
  proposedExperiments: z.array(
    z.object({
      name: z.string(),
      hypothesis: z.string(),
      metric: z.string(),
      variants: z.array(z.object({ label: z.string(), payload: z.record(z.unknown()) })),
    }),
  ).default([]),
});

export type StrategistInput = z.infer<typeof StrategistInputSchema>;
export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;

// ---------------------------------------------------------------------------
// Orchestrator job payloads
// ---------------------------------------------------------------------------

export const LeadGenJobPayloadSchema = z.object({
  campaignId: UuidSchema,
  targetCount: z.number().int().min(1).max(100).default(20),
  icpFilter: IcpFilterSchema,
});

export const ScoreLeadsJobPayloadSchema = z.object({
  campaignId: UuidSchema,
  companyIds: z.array(UuidSchema).optional(),
  minScore: z.number().int().min(0).max(100).default(60),
});

export const OutreachJobPayloadSchema = z.object({
  campaignId: UuidSchema,
  batchSize: z.number().int().min(1).max(50).default(10),
  dryRun: z.boolean().default(false),
  contactIds: z.array(UuidSchema).optional(),
});

export const ReplyTriageJobPayloadSchema = z.object({
  since: z.string().datetime(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const DailyReportJobPayloadSchema = z.object({
  channel: z.enum(["slack", "telegram", "email"]).default("telegram"),
  recipientId: z.string(),
});

export const LearningWeeklyJobPayloadSchema = z.object({}).default({});

export type LeadGenJobPayload = z.infer<typeof LeadGenJobPayloadSchema>;
export type ScoreLeadsJobPayload = z.infer<typeof ScoreLeadsJobPayloadSchema>;
export type OutreachJobPayload = z.infer<typeof OutreachJobPayloadSchema>;
export type ReplyTriageJobPayload = z.infer<typeof ReplyTriageJobPayloadSchema>;
export type DailyReportJobPayload = z.infer<typeof DailyReportJobPayloadSchema>;
export type LearningWeeklyJobPayload = z.infer<typeof LearningWeeklyJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Agent dispatch union
// ---------------------------------------------------------------------------

export const AgentInputSchema = z.discriminatedUnion("agentId", [
  ResearcherInputSchema,
  LeadScorerInputSchema,
  CopywriterInputSchema,
  ReplyClassifierInputSchema,
  QualifierInputSchema,
  StrategistInputSchema,
]);

export const AgentOutputSchema = z.union([
  ResearcherOutputSchema,
  LeadScorerOutputSchema,
  CopywriterOutputSchema,
  ReplyClassifierOutputSchema,
  QualifierOutputSchema,
  StrategistOutputSchema,
]);

export type AgentInput = z.infer<typeof AgentInputSchema>;
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// ---------------------------------------------------------------------------
// Policy check I/O
// ---------------------------------------------------------------------------

export const PolicyCheckInputSchema = z.object({
  action: z.enum([
    "send_email",
    "send_sequence",
    "quote_price",
    "send_proposal",
    "sign_contract",
    "publish_content",
    "enroll_campaign",
  ]),
  contactId: UuidSchema.optional(),
  campaignId: UuidSchema.optional(),
  rateCardId: z.string().optional(),
  customPriceCents: z.number().int().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const PolicyCheckOutputSchema = z.object({
  decision: PolicyDecisionSchema,
  reason: z.string(),
  approvalId: UuidSchema.optional(),
});

export type PolicyCheckInput = z.infer<typeof PolicyCheckInputSchema>;
export type PolicyCheckOutput = z.infer<typeof PolicyCheckOutputSchema>;
