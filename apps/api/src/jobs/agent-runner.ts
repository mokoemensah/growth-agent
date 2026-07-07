import type { AgentInput, AgentOutput } from "../../../../packages/schemas/index.js";
import {
  AgentInputSchema,
  CopywriterOutputSchema,
  LeadScorerOutputSchema,
  QualifierOutputSchema,
  ReplyClassifierOutputSchema,
  ResearcherOutputSchema,
  StrategistOutputSchema,
} from "../../../../packages/schemas/index.js";
import type { Db } from "./db.js";
import { loadDocs } from "./load-docs.js";
import { llmComplete } from "./llm.js";

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
  const systemPrompt = buildSystemPrompt(parsed.agentId, docs);
  const userPrompt = JSON.stringify({ input: parsed, context }, null, 2);

  const model = MODEL_BY_AGENT[parsed.agentId];
  const raw = await llmComplete({
    model,
    system: systemPrompt,
    user: userPrompt,
    responseFormat: "json",
  });

  const output = parseAgentOutput(parsed.agentId, raw);

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

function parseAgentOutput(agentId: AgentInput["agentId"], raw: { json: unknown }): AgentOutput {
  switch (agentId) {
    case "researcher":
      return ResearcherOutputSchema.parse(raw.json);
    case "lead_scorer":
      return LeadScorerOutputSchema.parse(raw.json);
    case "copywriter":
      return CopywriterOutputSchema.parse(raw.json);
    case "reply_classifier":
      return ReplyClassifierOutputSchema.parse(raw.json);
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

function buildSystemPrompt(agentId: AgentInput["agentId"], docs: Record<string, string>): string {
  return [
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
  ].join("\n");
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
