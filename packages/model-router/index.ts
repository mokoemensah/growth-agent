export type ModelTask = "repo_audit" | "pitch" | "security" | "strategy";

/** Cheapest defaults; override with REPO_AUDIT_MODEL for GLM-5.2 etc. */
export function modelFor(task: ModelTask): string {
  switch (task) {
    case "repo_audit":
      return process.env.REPO_AUDIT_MODEL ?? "openai/gpt-4o-mini";
    case "pitch":
      return process.env.PITCH_MODEL ?? "openai/gpt-4o-mini";
    case "security":
      return process.env.SECURITY_MODEL ?? process.env.REPO_AUDIT_MODEL ?? "openai/gpt-4o-mini";
    case "strategy":
      return process.env.STRATEGY_MODEL ?? "anthropic/claude-sonnet-4";
    default: {
      const _exhaustive: never = task;
      return _exhaustive;
    }
  }
}
