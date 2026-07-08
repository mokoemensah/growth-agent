import {
  ReplyClassifierOutputSchema,
  type ReplyClassifierOutput,
} from "../../../../packages/schemas/index.js";

const CLASSIFICATIONS = [
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
] as const;

const ACTIONS = [
  "book_meeting",
  "send_follow_up",
  "escalate_to_human",
  "add_to_nurture",
  "mark_lost",
  "suppress",
  "no_action",
] as const;

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const URGENCIES = ["high", "medium", "low"] as const;

type Classification = (typeof CLASSIFICATIONS)[number];
type Action = (typeof ACTIONS)[number];
type Sentiment = (typeof SENTIMENTS)[number];
type Urgency = (typeof URGENCIES)[number];

const INTENT_TO_ACTION: Record<string, Action> = {
  schedule_demo: "book_meeting",
  book_meeting: "book_meeting",
  book_call: "book_meeting",
  demo: "book_meeting",
  meeting: "book_meeting",
  follow_up: "send_follow_up",
  more_info: "send_follow_up",
  question: "send_follow_up",
  escalate: "escalate_to_human",
  human: "escalate_to_human",
  nurture: "add_to_nurture",
  not_now: "add_to_nurture",
  lost: "mark_lost",
  not_interested: "mark_lost",
  unsubscribe: "suppress",
  opt_out: "suppress",
  suppress: "suppress",
  no_action: "no_action",
};

const CLASSIFICATION_ALIASES: Record<string, Classification> = {
  positive: "interested",
  warm: "interested",
  hot: "interested",
  negative: "objection",
  cold: "objection",
  neutral: "question",
  ooo: "auto_reply",
  out_of_office: "auto_reply",
  opt_out: "unsubscribe",
};

const CLASSIFICATION_DEFAULT_ACTION: Record<Classification, Action> = {
  interested: "book_meeting",
  question: "send_follow_up",
  objection: "send_follow_up",
  not_now: "add_to_nurture",
  referral: "escalate_to_human",
  unsubscribe: "suppress",
  auto_reply: "no_action",
  bounce: "no_action",
  spam: "suppress",
  unknown: "escalate_to_human",
};

const CLASSIFICATION_DEFAULT_URGENCY: Record<Classification, Urgency> = {
  interested: "high",
  question: "medium",
  objection: "medium",
  not_now: "low",
  referral: "high",
  unsubscribe: "low",
  auto_reply: "low",
  bounce: "low",
  spam: "low",
  unknown: "medium",
};

const CLASSIFICATION_DEFAULT_SENTIMENT: Record<Classification, Sentiment> = {
  interested: "positive",
  question: "neutral",
  objection: "negative",
  not_now: "neutral",
  referral: "positive",
  unsubscribe: "negative",
  auto_reply: "neutral",
  bounce: "neutral",
  spam: "negative",
  unknown: "neutral",
};

function unwrapPayload(raw: unknown): Record<string, unknown> {
  let current: unknown = raw;
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
    return obj;
  }
  return typeof current === "object" && current !== null
    ? (current as Record<string, unknown>)
    : {};
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized as T) ? (normalized as T) : undefined;
}

function resolveClassification(obj: Record<string, unknown>): Classification {
  const direct = asEnum(obj.classification, CLASSIFICATIONS);
  if (direct) return direct;

  const alias =
    typeof obj.classification === "string"
      ? CLASSIFICATION_ALIASES[obj.classification.trim().toLowerCase()]
      : undefined;
  if (alias) return alias;

  const intent =
    typeof obj.intent === "string" ? obj.intent.trim().toLowerCase() : undefined;
  if (intent && INTENT_TO_ACTION[intent] === "book_meeting") return "interested";
  if (intent && INTENT_TO_ACTION[intent] === "suppress") return "unsubscribe";

  const sentiment = asEnum(obj.sentiment, SENTIMENTS);
  if (sentiment === "positive") return "interested";
  if (sentiment === "negative") return "objection";

  return "unknown";
}

function resolveAction(
  obj: Record<string, unknown>,
  classification: Classification,
): Action {
  const direct = asEnum(obj.suggestedNextAction, ACTIONS);
  if (direct) return direct;

  const nextAction = asEnum(obj.nextAction, ACTIONS);
  if (nextAction) return nextAction;

  const action = asEnum(obj.action, ACTIONS);
  if (action) return action;

  if (typeof obj.intent === "string") {
    const mapped = INTENT_TO_ACTION[obj.intent.trim().toLowerCase()];
    if (mapped) return mapped;
  }

  return CLASSIFICATION_DEFAULT_ACTION[classification];
}

function resolveSentiment(
  obj: Record<string, unknown>,
  classification: Classification,
): Sentiment {
  const direct = asEnum(obj.sentiment, SENTIMENTS);
  if (direct) return direct;

  if (typeof obj.classification === "string") {
    const alias = CLASSIFICATION_ALIASES[obj.classification.trim().toLowerCase()];
    if (alias === "interested") return "positive";
    if (alias === "objection") return "negative";
  }

  return CLASSIFICATION_DEFAULT_SENTIMENT[classification];
}

function resolveUrgency(
  obj: Record<string, unknown>,
  classification: Classification,
  action: Action,
): Urgency {
  const direct = asEnum(obj.urgency, URGENCIES);
  if (direct) return direct;

  if (action === "book_meeting" || action === "escalate_to_human") return "high";
  return CLASSIFICATION_DEFAULT_URGENCY[classification];
}

function resolveSummary(obj: Record<string, unknown>, inboundBody?: string): string {
  const candidates = [obj.summary, obj.message, obj.reason, obj.notes];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 500);
    }
  }
  if (inboundBody?.trim()) {
    return inboundBody.trim().slice(0, 500);
  }
  return "Inbound reply received";
}

export function coerceReplyClassifierOutput(
  raw: unknown,
  inboundBody?: string,
): ReplyClassifierOutput {
  const obj = unwrapPayload(raw);
  const classification = resolveClassification(obj);
  const suggestedNextAction = resolveAction(obj, classification);
  const sentiment = resolveSentiment(obj, classification);
  const urgency = resolveUrgency(obj, classification, suggestedNextAction);

  const confidence =
    typeof obj.confidence === "number"
      ? Math.min(1, Math.max(0, obj.confidence))
      : 0.75;

  const extractedQuestions = Array.isArray(obj.extractedQuestions)
    ? obj.extractedQuestions.filter((q): q is string => typeof q === "string")
    : [];

  const suggestedReply =
    typeof obj.suggestedReply === "string"
      ? obj.suggestedReply
      : typeof obj.reply === "string"
        ? obj.reply
        : undefined;

  return ReplyClassifierOutputSchema.parse({
    classification,
    confidence,
    sentiment,
    summary: resolveSummary(obj, inboundBody),
    extractedQuestions,
    suggestedNextAction,
    suggestedReply,
    urgency,
  });
}
