import type { JSONValue } from "postgres";
import type { StrategistInput } from "../schemas/index.js";
import { StrategistOutputSchema } from "../schemas/index.js";
import type { Db } from "../../apps/api/src/jobs/db.js";
import { runAgent } from "../../apps/api/src/jobs/agent-runner.js";
import { calibrateAllProductCac } from "./cac-calibration.js";
import { promoteExperimentWinners } from "./experiments.js";
import { collectPeriodMetrics } from "./metrics.js";
import { updateRouterWeightsFromCloses } from "./router-weights.js";

export interface WeeklyLearningResult {
  cacProductsUpdated: number;
  routerWeightsUpdated: number;
  experimentsPromoted: number;
  strategistSummary: string;
}

export async function runWeeklyLearning(
  db: Db,
  jobId: string,
): Promise<WeeklyLearningResult> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const metrics = await collectPeriodMetrics(db, periodStart, periodEnd);

  const strategistInput: StrategistInput = {
    agentId: "strategist",
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    metrics,
    jobId,
  };

  const strategistOutput = StrategistOutputSchema.parse(
    await runAgent(db, strategistInput),
  );

  await applyStrategistRecommendations(db, strategistOutput);

  const cacProductsUpdated = await calibrateAllProductCac(db);
  const routerWeightsUpdated = await updateRouterWeightsFromCloses(db);
  const experimentsPromoted = await promoteExperimentWinners(db);

  await db.sql`
    INSERT INTO agent_memory (namespace, key, value)
    VALUES (
      'learning',
      'weekly_report',
      ${db.sql.json({
        at: new Date().toISOString(),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metrics,
        summary: strategistOutput.summary,
        wins: strategistOutput.wins,
        losses: strategistOutput.losses,
        recommendations: strategistOutput.recommendations,
        cacProductsUpdated,
        routerWeightsUpdated,
        experimentsPromoted,
      } as unknown as JSONValue)}
    )
    ON CONFLICT (namespace, key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;

  await db.activities.create({
    type: "note",
    agentId: "strategist",
    jobId,
    body: strategistOutput.summary,
    metadata: {
      reportType: "weekly_learning",
      cacProductsUpdated,
      routerWeightsUpdated,
      experimentsPromoted,
    },
  });

  return {
    cacProductsUpdated,
    routerWeightsUpdated,
    experimentsPromoted,
    strategistSummary: strategistOutput.summary,
  };
}

async function applyStrategistRecommendations(
  db: Db,
  output: ReturnType<typeof StrategistOutputSchema.parse>,
): Promise<void> {
  for (const rec of output.recommendations) {
    if (rec.requiresApproval) continue;

    if (rec.type === "cap_change") {
      const match = rec.description.match(/(\d+)/);
      if (match) {
        const cap = Number(match[1]);
        await db.sql`
          INSERT INTO agent_memory (namespace, key, value)
          VALUES ('system', 'daily_send_cap', ${db.sql.json(cap as JSONValue)})
          ON CONFLICT (namespace, key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `;
      }
    }

    if (rec.type === "pause_campaign") {
      await db.sql`
        INSERT INTO agent_memory (namespace, key, value)
        VALUES ('system', 'outreach_paused', ${db.sql.json(true as JSONValue)})
        ON CONFLICT (namespace, key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
    }
  }

  for (const exp of output.proposedExperiments) {
    const [existing] = await db.sql<{ id: string }[]>`
      SELECT id FROM experiments
      WHERE name = ${exp.name} AND status = 'running'
      LIMIT 1
    `;
    if (existing) continue;

    const [row] = await db.sql<{ id: string }[]>`
      INSERT INTO experiments (name, hypothesis, metric, status)
      VALUES (${exp.name}, ${exp.hypothesis}, ${exp.metric}, 'running')
      RETURNING id
    `;

    for (const variant of exp.variants) {
      await db.sql`
        INSERT INTO experiment_variants (experiment_id, label, payload)
        VALUES (
          ${row.id},
          ${variant.label},
          ${db.sql.json(variant.payload as JSONValue)}
        )
        ON CONFLICT (experiment_id, label) DO NOTHING
      `;
    }
  }
}
