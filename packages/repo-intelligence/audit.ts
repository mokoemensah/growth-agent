import { modelFor } from "../model-router/index.js";
import { llmComplete } from "../../apps/api/src/jobs/llm.js";
import { archivedHeuristic, emptyHeuristic, scoreAudit } from "./score.js";
import type { RepoIntelligenceRecord, RepoSnapshot } from "./types.js";
import { RepoAuditReportSchema } from "./types.js";

const SYSTEM = [
  "You audit GitHub repos for productization and go-to-market potential.",
  "Return JSON matching this schema exactly:",
  JSON.stringify(
    {
      whatItDoes: "plain English summary",
      buyerType: "who would buy this",
      sellability: "high|medium|low|not_a_product",
      suggestedPriceCents: 29900,
      suggestedBilling: "monthly|annual|one_time|null",
      recommendedChannel: "seo|paid|outbound|none",
      seoTopics: ["topic1", "topic2"],
      paidAngle: "one line ad angle or null",
      securityNotes: ["defensive code/security observations only"],
      risks: ["product or market risks"],
      nextAction: "activate|improve_docs|merge|archive|ignore",
      confidence: 0.75,
    },
    null,
    2,
  ),
  "Rules: defensive security only. Be concise. No hype.",
].join("\n");

export async function auditSnapshot(snapshot: RepoSnapshot): Promise<RepoIntelligenceRecord> {
  const model = modelFor("repo_audit");

  if (snapshot.isArchived) {
    const report = archivedHeuristic(snapshot);
    return {
      auditedAt: new Date().toISOString(),
      model: "heuristic",
      snapshotHash: snapshot.snapshotHash,
      costUsd: 0,
      scores: scoreAudit(snapshot, report),
      recommendedChannel: report.recommendedChannel,
      nextAction: report.nextAction,
      report,
    };
  }

  const thin = !snapshot.readmeExcerpt && !snapshot.description?.trim();
  if (thin) {
    const report = emptyHeuristic(snapshot);
    return {
      auditedAt: new Date().toISOString(),
      model: "heuristic",
      snapshotHash: snapshot.snapshotHash,
      costUsd: 0,
      scores: scoreAudit(snapshot, report),
      recommendedChannel: report.recommendedChannel,
      nextAction: report.nextAction,
      report,
    };
  }

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.OPENROUTER_API_KEY) {
    const report = mockReport(snapshot);
    return {
      auditedAt: new Date().toISOString(),
      model: "mock",
      snapshotHash: snapshot.snapshotHash,
      costUsd: 0,
      scores: scoreAudit(snapshot, report),
      recommendedChannel: report.recommendedChannel,
      nextAction: report.nextAction,
      report,
    };
  }

  const raw = await llmComplete({
    model,
    system: SYSTEM,
    user: JSON.stringify(snapshot, null, 2),
    responseFormat: "json",
  });

  const parsed = RepoAuditReportSchema.safeParse(raw.json);
  if (!parsed.success) {
    throw new Error(`Invalid audit JSON for ${snapshot.slug}: ${parsed.error.message}`);
  }

  return {
    auditedAt: new Date().toISOString(),
    model,
    snapshotHash: snapshot.snapshotHash,
    costUsd: raw.usage.costUsd,
    scores: scoreAudit(snapshot, parsed.data),
    recommendedChannel: parsed.data.recommendedChannel,
    nextAction: parsed.data.nextAction,
    report: parsed.data,
  };
}

function mockReport(snapshot: RepoSnapshot) {
  const lang = snapshot.primaryLanguage ?? "software";
  const base =
    snapshot.description?.trim() ||
    `${snapshot.name} is a ${lang} project — needs review before selling.`;
  return RepoAuditReportSchema.parse({
    whatItDoes: base.length >= 5 ? base : `${snapshot.name} software tool.`,
    buyerType: "developers or small teams",
    sellability: snapshot.readmeExcerpt ? "medium" : "low",
    suggestedPriceCents: 4900,
    suggestedBilling: "monthly",
    recommendedChannel: "seo",
    seoTopics: [`${snapshot.name} tool`, `${lang} automation`],
    paidAngle: null,
    securityNotes: [],
    risks: ["Mock audit — set OPENROUTER_API_KEY for real analysis"],
    nextAction: "improve_docs",
    confidence: 0.5,
  });
}
