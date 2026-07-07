export type ModelTask = "repo_audit" | "pitch" | "security" | "strategy";

/** Cheapest defaults; override with REPO_AUDIT_MODEL for GLM-5.2 etc. */
export function modelFor(task: ModelTask): string {
  switch (task) {
    case "repo_audit":
      return process.env.REPO_AUDIT_MODEL ?? "google/gemini-2.0-flash-001";
    case "pitch":
      return process.env.PITCH_MODEL ?? "google/gemini-2.0-flash-001";
    case "security":
      return process.env.SECURITY_MODEL ?? process.env.REPO_AUDIT_MODEL ?? "google/gemini-2.0-flash-001";
    case "strategy":
      return process.env.STRATEGY_MODEL ?? "anthropic/claude-sonnet-4";
    default: {
      const _exhaustive: never = task;
      return _exhaustive;
    }
  }
}
