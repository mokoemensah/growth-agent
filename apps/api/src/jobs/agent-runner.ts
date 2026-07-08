import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import type { AgentInput, AgentOutput } from "../../../../packages/schemas/index.js";
import {
  AgentInputSchema,
  CopywriterOutputSchema,
  LeadScorerOutputSchema,
  QualifierOutputSchema,
  ResearcherOutputSchema,
  StrategistOutputSchema,
} from "../../../../packages/schemas/index.js";
import type { Db } from "./db.js";
import { loadDocs } from "./load-docs.js";
import { llmComplete } from "./llm.js";
import { coerceReplyClassifierOutput } from "./normalize-reply-classifier.js";

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

export async function runAgent<T extends AgentInput>(
  db: Db,
  input: T,
): Promise<AgentOutput> {
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

  const output = parseAgentOutput(
    parsed.agentId,
    raw,
    parsed.agentId === "reply_classifier" ? parsed.inboundBody : undefined,
  );

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

  return output;
}

function parseAgentOutput(
  agentId: AgentInput["agentId"],
  raw: { json: unknown },
  inboundBody?: string,
): AgentOutput {
  switch (agentId) {
    case "researcher":
      return ResearcherOutputSchema.parse(raw.json);
    case "lead_scorer":
      return LeadScorerOutputSchema.parse(raw.json);
    case "copywriter":
      return CopywriterOutputSchema.parse(raw.json);
    case "reply_classifier":
      return coerceReplyClassifierOutput(raw.json, inboundBody);
    case "qualifier":
      return QualifierOutputSchema.parse(raw.json);
    case "strategist":
      return StrategistOutputSchema.parse(raw.json);
    default: {
      const _exhaustive: never = agentId;
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

  if (agentId === "reply_classifier") {
    const exampleOutput = await loadExampleOutput("reply_classifier");
    lines.push(
      "",
      "--- REQUIRED OUTPUT JSON (use these exact field names) ---",
      JSON.stringify(exampleOutput, null, 2),
      "",
      "Rules:",
      "- classification must be one of: interested, question, objection, not_now, referral, unsubscribe, auto_reply, bounce, spam, unknown",
      "- suggestedNextAction must be one of: book_meeting, send_follow_up, escalate_to_human, add_to_nurture, mark_lost, suppress, no_action",
      "- urgency must be one of: high, medium, low",
      "- Do NOT use keys like response, intent, or positive/negative as classification",
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
