import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "../../../../packages/schemas/examples");

export interface LlmCompleteInput {
  model: string;
  system: string;
  user: string;
  responseFormat: "json";
}

export interface LlmCompleteResult {
  json: unknown;
  usage: {
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  };
}

const MOCK_EXAMPLES: Record<string, string> = {
  researcher: "researcher.example.json",
  lead_scorer: "lead_scorer.example.json",
  copywriter: "copywriter.example.json",
  reply_classifier: "reply_classifier.example.json",
  qualifier: "qualifier.example.json",
  strategist: "strategist.example.json",
};

export async function llmComplete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.OPENROUTER_API_KEY) {
    return mockComplete(input);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL ?? "https://growth-agent.local",
      "X-Title": "Growth Agent",
    },
    body: JSON.stringify({
      model: input.model.startsWith("openrouter/") ? input.model : input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(stripMarkdownFences(content)) as unknown;

  const json = unwrapAgentJson(parsed);

  return {
    json,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      costUsd: estimateCost(input.model, data.usage),
    },
  };
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function estimateCost(
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
): number {
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;

  const rates: Record<string, [number, number]> = {
    "google/gemini-2.0-flash-001": [0.1, 0.4],
    "anthropic/claude-sonnet-4": [3, 15],
  };

  const [inputPer1M, outputPer1M] = rates[model] ?? [1, 3];
  return (prompt * inputPer1M + completion * outputPer1M) / 1_000_000;
}

async function mockComplete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
  const agentMatch = input.system.match(/You are the ([\w_]+) agent/);
  const agentId = agentMatch?.[1] ?? "researcher";
  const exampleFile = MOCK_EXAMPLES[agentId] ?? "researcher.example.json";

  try {
    const raw = await readFile(join(EXAMPLES_DIR, exampleFile), "utf-8");
    const example = JSON.parse(raw) as { output: unknown };
    console.log(`[mock-llm] ${agentId} → returning example output`);
    return {
      json: example.output,
      usage: { promptTokens: 500, completionTokens: 200, costUsd: 0.0001 },
    };
  } catch {
    return {
      json: { error: "mock example not found", agentId },
      usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
    };
  }
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
}

function unwrapAgentJson(parsed: unknown): unknown {
  let current = parsed;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "object" || current === null) break;
    const obj = current as Record<string, unknown>;
    if ("output" in obj) {
      current = obj.output;
      continue;
    }
    if ("response" in obj) {
      current = obj.response;
      continue;
    }
    break;
  }
  return current;
}
