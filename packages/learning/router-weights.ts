import type { JSONValue } from "postgres";
import type { Db } from "../../apps/api/src/jobs/db.js";

export async function updateRouterWeightsFromCloses(db: Db): Promise<number> {
  const rows = await db.sql<{ product_id: string; won: number }[]>`
    SELECT product_id, COUNT(*)::int AS won
    FROM contacts
    WHERE product_id IS NOT NULL AND status = 'won'
    GROUP BY product_id
  `;

  if (rows.length === 0) return 0;

  const totalWon = rows.reduce((sum, r) => sum + r.won, 0);
  let updated = 0;

  const products = await db.products.listActive();

  for (const product of products) {
    const wins = rows.find((r) => r.product_id === product.id)?.won ?? 0;
    const share = totalWon > 0 ? wins / totalWon : 0;
    const routerWeight = Math.round((1 + share * 0.5) * 100) / 100;

    const metadata = {
      ...product.metadata,
      routerWeight,
      routerWeightUpdatedAt: new Date().toISOString(),
      closeStats: { won: wins, totalWon },
    };

    await db.sql`
      UPDATE products
      SET metadata = ${db.sql.json(metadata as JSONValue)}, updated_at = now()
      WHERE id = ${product.id}
    `;
    updated += 1;
  }

  return updated;
}

export function routerWeightFromMetadata(metadata: Record<string, unknown>): number {
  const w = metadata.routerWeight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}
