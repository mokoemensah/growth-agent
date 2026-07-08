import { WEEKLY_GOALS } from "@/lib/brand";
import type { WeeklyMetrics } from "@/lib/queries";

interface GoalTrackerProps {
  weekly: WeeklyMetrics;
}

function pct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function Bar({ label, current, target }: { label: string; current: number; target: number }) {
  const progress = pct(current, target);
  const onTrack = progress >= 50 || current > 0;

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-200">
          {current}
          <span className="text-zinc-500"> / {target}</span>
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-border">
        <div
          className={`h-full rounded-full transition-all ${onTrack ? "bg-accent" : "bg-zinc-600"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function GoalTracker({ weekly }: GoalTrackerProps) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
        Weekly goals
      </p>
      <div className="mt-4 space-y-4">
        <Bar label="Meetings booked" current={weekly.meetingsBooked} target={WEEKLY_GOALS.meetings} />
        <Bar label="Replies" current={weekly.replies} target={WEEKLY_GOALS.replies} />
        <Bar label="Emails sent" current={weekly.emailsSent} target={WEEKLY_GOALS.sends} />
      </div>
    </div>
  );
}
