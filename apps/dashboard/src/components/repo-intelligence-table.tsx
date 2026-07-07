import Link from "next/link";
import type { ProductRow } from "@/lib/queries";

interface Props {
  products: ProductRow[];
  total: number;
}

export function RepoIntelligenceTable({ products, total }: Props) {
  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-surface-border bg-surface-raised p-8 text-center text-sm text-zinc-400">
        No audits yet. Run{" "}
        <code className="text-zinc-300">npm run repo:audit -- --limit 10</code> from the repo
        root.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-surface-border">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-surface-border bg-surface-raised text-zinc-400">
          <tr>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Readiness</th>
            <th className="px-4 py-3">Sell</th>
            <th className="px-4 py-3">SEO</th>
            <th className="px-4 py-3">Paid</th>
            <th className="px-4 py-3">Channel</th>
            <th className="px-4 py-3">Next</th>
            <th className="px-4 py-3">Summary</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const i = p.intelligence!;
            const s = i.scores;
            return (
              <tr key={p.id} className="border-b border-surface-border/60 hover:bg-surface-raised/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-zinc-500">{p.slug}</div>
                </td>
                <td className="px-4 py-3 tabular-nums font-semibold text-accent">{s.readinessScore}</td>
                <td className="px-4 py-3 tabular-nums">{s.sellabilityScore}</td>
                <td className="px-4 py-3 tabular-nums">{s.seoOpportunityScore}</td>
                <td className="px-4 py-3 tabular-nums">{s.paidFitScore}</td>
                <td className="px-4 py-3 capitalize">{i.recommendedChannel}</td>
                <td className="px-4 py-3 capitalize text-zinc-400">{i.nextAction.replace("_", " ")}</td>
                <td className="max-w-md px-4 py-3 text-xs text-zinc-400">
                  {i.report.whatItDoes}
                  {p.landingPath ? (
                    <>
                      {" "}
                      <Link href={p.landingPath} className="text-accent hover:underline">
                        Landing →
                      </Link>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-surface-border px-4 py-2 text-xs text-zinc-500">
        Showing top {products.length} audited of {total} catalog products.
      </p>
    </div>
  );
}
