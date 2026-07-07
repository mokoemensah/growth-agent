import type { JSONValue } from "postgres";
import type { Db } from "../../apps/api/src/jobs/db.js";

export const MIN_VARIANT_IMPRESSIONS = Number(process.env.EXPERIMENT_MIN_IMPRESSIONS ?? 10);

export interface SubjectVariant {
  id: string;
  experimentId: string;
  label: string;
  subject: string;
  impressions: number;
  conversions: number;
}

const DEFAULT_SUBJECT_VARIANTS = (base: string) => [
  { label: "A", subject: base },
  { label: "B", subject: `Quick question — ${base.replace(/^(re:\s*)?/i, "")}` },
  { label: "C", subject: `${base.replace(/\.$/, "")}?` },
];

export async function ensureSubjectLineExperiment(
  db: Db,
  campaignId: string,
  baseSubject: string,
): Promise<string> {
  const [existing] = await db.sql<{ id: string }[]>`
    SELECT id FROM experiments
    WHERE campaign_id = ${campaignId}
      AND status = 'running'
      AND metric = 'reply_rate'
      AND name = 'subject_lines'
    LIMIT 1
  `;
  if (existing) return existing.id;

  const [experiment] = await db.sql<{ id: string }[]>`
    INSERT INTO experiments (campaign_id, name, hypothesis, metric, status)
    VALUES (
      ${campaignId},
      'subject_lines',
      'Subject line variants improve reply rate',
      'reply_rate',
      'running'
    )
    RETURNING id
  `;

  for (const variant of DEFAULT_SUBJECT_VARIANTS(baseSubject)) {
    await db.sql`
      INSERT INTO experiment_variants (experiment_id, label, payload)
      VALUES (
        ${experiment.id},
        ${variant.label},
        ${db.sql.json({ subject: variant.subject } as JSONValue)}
      )
      ON CONFLICT (experiment_id, label) DO NOTHING
    `;
  }

  return experiment.id;
}

export async function pickSubjectVariant(
  db: Db,
  experimentId: string,
): Promise<SubjectVariant | null> {
  const rows = await db.sql<
    {
      id: string;
      experiment_id: string;
      label: string;
      payload: { subject?: string };
      impressions: number;
      conversions: number;
    }[]
  >`
    SELECT id, experiment_id, label, payload, impressions, conversions
    FROM experiment_variants
    WHERE experiment_id = ${experimentId}
    ORDER BY impressions ASC, label ASC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    experimentId: row.experiment_id,
    label: row.label,
    subject: row.payload.subject ?? "",
    impressions: row.impressions,
    conversions: row.conversions,
  };
}

export async function recordVariantImpression(db: Db, variantId: string): Promise<void> {
  await db.sql`
    UPDATE experiment_variants
    SET impressions = impressions + 1
    WHERE id = ${variantId}
  `;
}

export async function recordReplyConversion(db: Db, contactId: string): Promise<void> {
  const [outbound] = await db.sql<{ variant_id: string | null }[]>`
    SELECT variant_id FROM email_messages
    WHERE contact_id = ${contactId}
      AND direction = 'outbound'
      AND variant_id IS NOT NULL
    ORDER BY sent_at DESC NULLS LAST
    LIMIT 1
  `;
  if (!outbound?.variant_id) return;

  await db.sql`
    UPDATE experiment_variants
    SET conversions = conversions + 1
    WHERE id = ${outbound.variant_id}
  `;
}

function variantScore(conversions: number, impressions: number): number {
  return (conversions + 1) / (impressions + 2);
}

export async function promoteExperimentWinners(db: Db): Promise<number> {
  const experiments = await db.sql<{ id: string; campaign_id: string | null }[]>`
    SELECT id, campaign_id FROM experiments
    WHERE status = 'running' AND metric = 'reply_rate'
  `;

  let promoted = 0;

  for (const experiment of experiments) {
    const variants = await db.sql<
      {
        id: string;
        label: string;
        payload: { subject?: string };
        impressions: number;
        conversions: number;
      }[]
    >`
      SELECT id, label, payload, impressions, conversions
      FROM experiment_variants
      WHERE experiment_id = ${experiment.id}
    `;

    if (variants.length === 0) continue;
    if (variants.some((v) => v.impressions < MIN_VARIANT_IMPRESSIONS)) continue;

    let winner = variants[0];
    let bestScore = variantScore(winner.conversions, winner.impressions);
    for (const v of variants.slice(1)) {
      const score = variantScore(v.conversions, v.impressions);
      if (score > bestScore) {
        winner = v;
        bestScore = score;
      }
    }

    const winningSubject = winner.payload.subject ?? "";
    await db.sql`
      UPDATE experiments
      SET status = 'completed',
          ended_at = now(),
          winner_variant_id = ${winner.id},
          metadata = metadata || ${db.sql.json({ promotedAt: new Date().toISOString(), winnerLabel: winner.label } as JSONValue)}
      WHERE id = ${experiment.id}
    `;

    if (experiment.campaign_id && winningSubject) {
      await db.sql`
        UPDATE sequences
        SET subject_template = ${winningSubject}
        WHERE campaign_id = ${experiment.campaign_id} AND step_number = 1
      `;
      await db.sql`
        INSERT INTO agent_memory (namespace, key, value)
        VALUES (
          'playbook',
          ${`campaign:${experiment.campaign_id}:subject_line`},
          ${db.sql.json({ subject: winningSubject, variantLabel: winner.label, experimentId: experiment.id } as JSONValue)}
        )
        ON CONFLICT (namespace, key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
    }

    promoted += 1;
  }

  return promoted;
}
