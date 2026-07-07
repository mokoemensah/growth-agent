import type { Db } from "../../apps/api/src/jobs/db.js";

export interface PeriodMetrics {
  emailsSent: number;
  replies: number;
  meetingsBooked: number;
  costUsd: number;
  openRate: number;
  replyRate: number;
  positiveReplyRate: number;
  topVariants: { label: string; replyRate: number }[];
}

export async function collectPeriodMetrics(
  db: Db,
  periodStart: Date,
  periodEnd: Date,
): Promise<PeriodMetrics> {
  const [activity] = await db.sql<
    {
      emails_sent: string;
      replies: string;
      meetings_booked: string;
      cost_usd: string;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE type = 'email_sent')::text AS emails_sent,
      COUNT(*) FILTER (WHERE type = 'email_replied')::text AS replies,
      COUNT(*) FILTER (WHERE type = 'meeting_booked')::text AS meetings_booked,
      COALESCE((
        SELECT SUM(cost_usd) FROM audit_log
        WHERE created_at >= ${periodStart} AND created_at < ${periodEnd}
      ), 0)::text AS cost_usd
    FROM activities
    WHERE occurred_at >= ${periodStart} AND occurred_at < ${periodEnd}
  `;

  const emailsSent = Number(activity?.emails_sent ?? 0);
  const replies = Number(activity?.replies ?? 0);
  const meetingsBooked = Number(activity?.meetings_booked ?? 0);

  const variantRows = await db.sql<
    { label: string; impressions: number; conversions: number }[]
  >`
    SELECT ev.label, ev.impressions, ev.conversions
    FROM experiment_variants ev
    JOIN experiments e ON e.id = ev.experiment_id
    WHERE e.status = 'running' AND ev.impressions > 0
    ORDER BY (ev.conversions::float / NULLIF(ev.impressions, 0)) DESC
    LIMIT 5
  `;

  const [positive] = await db.sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM activities
    WHERE type = 'email_replied'
      AND occurred_at >= ${periodStart}
      AND occurred_at < ${periodEnd}
      AND metadata->>'classification' IN ('positive', 'interested', 'meeting_request')
  `;

  const replyRate = emailsSent > 0 ? replies / emailsSent : 0;
  const positiveCount = Number(positive?.count ?? 0);

  return {
    emailsSent,
    replies,
    meetingsBooked,
    costUsd: Number(activity?.cost_usd ?? 0),
    openRate: 0,
    replyRate,
    positiveReplyRate: replies > 0 ? positiveCount / replies : 0,
    topVariants: variantRows.map((v) => ({
      label: v.label,
      replyRate: v.impressions > 0 ? v.conversions / v.impressions : 0,
    })),
  };
}
