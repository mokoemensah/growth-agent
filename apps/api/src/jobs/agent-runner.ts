import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import type {
  AgentInput,
  AgentOutput,
  CopywriterOutput,
  LeadScorerOutput,
  QualifierOutput,
  ReplyClassifierOutput,
  ResearcherOutput,
  StrategistOutput,
} from "../../../../packages/schemas/index.js";
import {
  AgentInputSchema,
  QualifierOutputSchema,
  StrategistOutputSchema,
} from "../../../../packages/schemas/index.js";
import type { Db } from "./db.js";
import { loadDocs } from "./load-docs.js";
import { llmComplete } from "./llm.js";
import { coerceCopywriterOutput } from "./normalize-copywriter.js";
import { coerceLeadScorerOutput } from "./normalize-lead-scorer.js";
import { coerceReplyClassifierOutput } from "./normalize-reply-classifier.js";
import { coerceResearcherOutput } from "./normalize-researcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "../../../../packages/schemas/examples");

const MODEL_BY_AGENT: Record<AgentInput["agentId"], string> = {
  researcher: "openai/gpt-4o-mini",
  lead_scorer: "openai/gpt-4o-mini",
  copywriter: "openai/gpt-4o-mini",
  reply_classifier: "openai/gpt-4o-mini",
  qualifier: "anthropic/claude-sonnet-4",
  strategist: "anthropic/claude-sonnet-4",
};

type AgentOutputFor<T extends AgentInput> = T extends { agentId: "researcher" }
  ? ResearcherOutput
  : T extends { agentId: "lead_scorer" }
    ? LeadScorerOutput
    : T extends { agentId: "copywriter" }
      ? CopywriterOutput
      : T extends { agentId: "reply_classifier" }
        ? ReplyClassifierOutput
        : T extends { agentId: "qualifier" }
          ? QualifierOutput
          : T extends { agentId: "strategist" }
            ? StrategistOutput
            : AgentOutput;

export async function runAgent<T extends AgentInput>(
  db: Db,
  input: T,
): Promise<AgentOutputFor<T>> {
  const parsed = AgentInputSchema.parse(input);
  const started = Date.now();
  const productSlug = "productSlug" in parsed ? parsed.productSlug : undefined;
  const docs = await loadDocs(["ICP", "OFFER", "VOICE", "PLAYBOOK", "RATE_CARD"], productSlug);

  const context = await buildContext(db, parsed);
  const systemPrompt = await buildSystemPrompt(parsed.agentId, docs);
  const userPrompt = JSON.stringify({ input: parsed, context }, null, 2);

  const model = MODEL_BY_AGENT[parsed.agentId];
  const raw = await llmComplete({
    model,
    system: systemPrompt,
    user: userPrompt,
    responseFormat: "json",
  });

  const output = parseAgentOutput(parsed, raw);

  await db.auditLog.create({
    agentId: parsed.agentId,
    action: `${parsed.agentId}.run`,
    entityType: entityTypeFor(parsed),
    entityId: entityIdFor(parsed),
    input: parsed,
    output,
    model,
    promptTokens: raw.usage.promptTokens,
    completionTokens: raw.usage.completionTokens,
    costUsd: raw.usage.costUsd,
    latencyMs: Date.now() - started,
    jobId: "jobId" in parsed ? parsed.jobId : undefined,
    policyDecision: "allow",
  });

  return output as AgentOutputFor<T>;
}

function parseAgentOutput(input: AgentInput, raw: { json: unknown }): AgentOutput {
  switch (input.agentId) {
    case "researcher":
      return coerceResearcherOutput(raw.json, input);
    case "lead_scorer":
      return coerceLeadScorerOutput(raw.json);
    case "copywriter":
      return coerceCopywriterOutput(raw.json);
    case "reply_classifier":
      return coerceReplyClassifierOutput(raw.json, input.inboundBody);
    case "qualifier":
      return QualifierOutputSchema.parse(raw.json);
    case "strategist":
      return StrategistOutputSchema.parse(raw.json);
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

async function buildSystemPrompt(
  agentId: AgentInput["agentId"],
  docs: Record<string, string>,
): Promise<string> {
  const lines = [
    `You are the ${agentId} agent in an autonomous marketing/sales system.`,
    "Return ONLY valid JSON matching the output schema. No markdown fences.",
    "Never invent pricing — use RATE_CARD only.",
    "Never promise delivery timelines not in OFFER.",
    "",
    "--- ICP ---",
    docs.ICP ?? "",
    "--- OFFER ---",
    docs.OFFER ?? "",
    "--- VOICE ---",
    docs.VOICE ?? "",
    "--- PLAYBOOK ---",
    docs.PLAYBOOK ?? "",
    "--- RATE CARD ---",
    docs.RATE_CARD ?? "",
  ];

  if (
    agentId === "reply_classifier" ||
    agentId === "copywriter" ||
    agentId === "researcher" ||
    agentId === "lead_scorer"
  ) {
    const exampleOutput = await loadExampleOutput(agentId);
    lines.push(
      "",
      "--- REQUIRED OUTPUT JSON (use these exact field names) ---",
      JSON.stringify(exampleOutput, null, 2),
    );
  }

  if (agentId === "reply_classifier") {
    lines.push(
      "",
      "Rules:",
      "- classification must be one of: interested, question, objection, not_now, referral, unsubscribe, auto_reply, bounce, spam, unknown",
      "- suggestedNextAction must be one of: book_meeting, send_follow_up, escalate_to_human, add_to_nurture, mark_lost, suppress, no_action",
      "- urgency must be one of: high, medium, low",
      "- Do NOT use keys like response, intent, or positive/negative as classification",
    );
  }

  if (agentId === "copywriter") {
    lines.push(
      "",
      "Rules:",
      "- bodyText is required (plain text email body, 50+ chars)",
      "- callToAction is required (one short sentence)",
      "- toneCheck must be { onBrand: boolean, issues: string[] }",
      "- Do NOT nest under email/draft/result — return flat JSON with bodyText, subject, callToAction, toneCheck",
    );
  }

  if (agentId === "researcher") {
    lines.push(
      "",
      "Rules:",
      "- Return flat JSON with domain, companyName, industry, employeeCount, country, description, linkedinUrl, confidence",
      "- description is required (1-3 sentences)",
      "- confidence is a number 0-1",
    );
  }

  if (agentId === "lead_scorer") {
    lines.push(
      "",
      "Rules:",
      "- companyScore is required (0-100 integer)",
      "- fit must be one of: high, medium, low, disqualified",
      "- reasons is a non-empty array of strings",
      "- recommendedAction must be one of: enroll_outreach, nurture_only, skip, manual_review",
    );
  }

  return lines.join("\n");
}

async function loadExampleOutput(agentId: string): Promise<unknown> {
  try {
    const raw = await readFile(join(EXAMPLES_DIR, `${agentId}.example.json`), "utf-8");
    const example = JSON.parse(raw) as { output: unknown };
    return example.output;
  } catch {
    return {};
  }
}

async function buildContext(db: Db, input: AgentInput): Promise<Record<string, unknown>> {
  if ("contactId" in input && input.contactId) {
    const contact = await db.contacts.get(input.contactId);
    const company = await db.companies.get(contact.companyId);
    return { contact, company };
  }
  if ("companyId" in input && input.companyId) {
    const company = await db.companies.get(input.companyId);
    return { company };
  }
  return {};
}

function entityTypeFor(input: AgentInput): string | undefined {
  if ("contactId" in input && input.contactId) return "contact";
  if ("companyId" in input && input.companyId) return "company";
  return undefined;
}

function entityIdFor(input: AgentInput): string | undefined {
  if ("contactId" in input && input.contactId) return input.contactId;
  if ("companyId" in input && input.companyId) return input.companyId;
  return undefined;
}
