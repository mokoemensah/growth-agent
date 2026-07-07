import type { RepoAuditReport, RepoIntelligenceScores, RepoSnapshot } from "./types.js";

const SELLABILITY: Record<RepoAuditReport["sellability"], number> = {
  high: 85,
  medium: 60,
  low: 35,
  not_a_product: 10,
};

const CHANNEL_SCORES: Record<RepoAuditReport["recommendedChannel"], { seo: number; paid: number }> = {
  seo: { seo: 80, paid: 30 },
  paid: { seo: 40, paid: 85 },
  outbound: { seo: 50, paid: 45 },
  none: { seo: 15, paid: 10 },
};

export function scoreAudit(
  snapshot: RepoSnapshot,
  report: RepoAuditReport,
): RepoIntelligenceScores {
  const sellabilityScore = Math.round(SELLABILITY[report.sellability] * report.confidence);
  const channel = CHANNEL_SCORES[report.recommendedChannel];
  const seoOpportunityScore = Math.round(channel.seo * report.confidence);
  const paidFitScore = Math.round(channel.paid * report.confidence);

  const securityRiskScore = Math.min(
    100,
    report.securityNotes.length * 12 + report.risks.length * 8,
  );

  let readiness = sellabilityScore * 0.45;
  if (snapshot.readmeExcerpt) readiness += 15;
  if (snapshot.manifestExcerpt) readiness += 10;
  if (report.suggestedPriceCents && report.suggestedPriceCents > 0) readiness += 10;
  if (!snapshot.isArchived) readiness += 10;
  if (report.nextAction === "archive" || report.nextAction === "ignore") readiness *= 0.3;

  return {
    sellabilityScore,
    securityRiskScore,
    seoOpportunityScore,
    paidFitScore,
    readinessScore: Math.round(Math.min(100, readiness)),
  };
}

export function archivedHeuristic(snapshot: RepoSnapshot): RepoAuditReport {
  return {
    whatItDoes: snapshot.description ?? `${snapshot.name} — archived or inactive repo.`,
    buyerType: "none",
    sellability: "not_a_product",
    suggestedPriceCents: null,
    suggestedBilling: null,
    recommendedChannel: "none",
    seoTopics: [],
    paidAngle: null,
    securityNotes: [],
    risks: ["Repository is archived"],
    nextAction: "archive",
    confidence: 0.95,
  };
}

export function emptyHeuristic(snapshot: RepoSnapshot): RepoAuditReport {
  const desc = snapshot.description?.trim() || "No README or description available.";
  return {
    whatItDoes: desc,
    buyerType: "unknown",
    sellability: "low",
    suggestedPriceCents: null,
    suggestedBilling: null,
    recommendedChannel: "none",
    seoTopics: [],
    paidAngle: null,
    securityNotes: [],
    risks: ["Thin documentation — hard to market without more context"],
    nextAction: "improve_docs",
    confidence: 0.4,
  };
}
