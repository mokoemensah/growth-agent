import type { JSONValue } from "postgres";
import {
  parseProductCacAssumptions,
  type ProductCacAssumptions,
} from "../economics/cac.js";
import type { Db } from "../../apps/api/src/jobs/db.js";

interface FunnelRow {
  product_id: string;
  contacted: number;
  replied: number;
  meetings: number;
  won: number;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function calibrateProductCac(
  db: Db,
  productId: string,
  funnel: FunnelRow,
): Promise<ProductCacAssumptions | null> {
  if (funnel.contacted < 5) return null;

  const product = await db.products.get(productId);
  const current = parseProductCacAssumptions(
    (product.metadata.cac as Record<string, unknown> | undefined) ?? {},
  );

  const replyRatePct = pct(funnel.replied, funnel.contacted);
  const meetingRatePct = pct(funnel.meetings, Math.max(funnel.replied, 1));
  const closeRatePct = pct(funnel.won, Math.max(funnel.meetings, 1));

  const blend = (observed: number, assumed: number) =>
    Math.round((observed * 0.7 + assumed * 0.3) * 10) / 10;

  const calibrated: ProductCacAssumptions = {
    ...current,
    replyRatePct: blend(replyRatePct, current.replyRatePct),
    meetingRatePct: blend(meetingRatePct, current.meetingRatePct),
    closeRatePct: blend(closeRatePct, current.closeRatePct),
  };

  const metadata = {
    ...product.metadata,
    cac: {
      ...calibrated,
      calibratedAt: new Date().toISOString(),
      observed: {
        contacted: funnel.contacted,
        replied: funnel.replied,
        meetings: funnel.meetings,
        won: funnel.won,
      },
    },
  };

  await db.sql`
    UPDATE products
    SET metadata = ${db.sql.json(metadata as JSONValue)}, updated_at = now()
    WHERE id = ${productId}
  `;

  return calibrated;
}

export async function calibrateAllProductCac(db: Db): Promise<number> {
  const rows = await db.sql<FunnelRow[]>`
    SELECT
      product_id,
      COUNT(*) FILTER (WHERE status IN ('contacted','replied','interested','meeting_booked','qualified','proposal_sent','won','lost','not_now','objection'))::int AS contacted,
      COUNT(*) FILTER (WHERE status IN ('replied','interested','meeting_booked','qualified','proposal_sent','won'))::int AS replied,
      COUNT(*) FILTER (WHERE status IN ('meeting_booked','qualified','proposal_sent','won'))::int AS meetings,
      COUNT(*) FILTER (WHERE status = 'won')::int AS won
    FROM contacts
    WHERE product_id IS NOT NULL AND NOT do_not_contact
    GROUP BY product_id
  `;

  let updated = 0;
  for (const row of rows) {
    const result = await calibrateProductCac(db, row.product_id, row);
    if (result) updated += 1;
  }
  return updated;
}
