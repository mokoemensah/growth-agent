import { z } from "zod";

export const RepoAuditReportSchema = z.object({
  whatItDoes: z.string().min(5).max(600),
  buyerType: z.string().min(2).max(120),
  sellability: z.enum(["high", "medium", "low", "not_a_product"]),
  suggestedPriceCents: z.number().int().min(0).max(1_000_000_00).nullable(),
  suggestedBilling: z.enum(["one_time", "monthly", "annual"]).nullable(),
  recommendedChannel: z.enum(["seo", "paid", "outbound", "none"]),
  seoTopics: z.array(z.string()).max(5),
  paidAngle: z.string().max(300).nullable(),
  securityNotes: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5),
  nextAction: z.enum(["activate", "improve_docs", "merge", "archive", "ignore"]),
  confidence: z.number().min(0).max(1),
});

export type RepoAuditReport = z.infer<typeof RepoAuditReportSchema>;

export interface RepoSnapshot {
  repo: string;
  slug: string;
  name: string;
  description: string | null;
  primaryLanguage: string | null;
  topics: string[];
  isArchived: boolean;
  pushedAt: string | null;
  readmeExcerpt: string | null;
  manifestExcerpt: string | null;
  filePaths: string[];
  snapshotHash: string;
}

export interface RepoIntelligenceScores {
  sellabilityScore: number;
  securityRiskScore: number;
  seoOpportunityScore: number;
  paidFitScore: number;
  readinessScore: number;
}

export interface RepoIntelligenceRecord {
  auditedAt: string;
  model: string;
  snapshotHash: string;
  costUsd: number;
  scores: RepoIntelligenceScores;
  recommendedChannel: RepoAuditReport["recommendedChannel"];
  nextAction: RepoAuditReport["nextAction"];
  report: RepoAuditReport;
}
