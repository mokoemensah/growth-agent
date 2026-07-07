import Link from "next/link";
import { DashboardNav } from "@/components/dashboard-nav";
import { RepoIntelligenceTable } from "@/components/repo-intelligence-table";
import { getProducts, getRepoIntelligenceProducts } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RepoIntelligencePage() {
  const [all, ranked] = await Promise.all([getProducts(), getRepoIntelligenceProducts()]);

  return (
    <div className="min-h-screen">
      <DashboardNav />
      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Repo intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Ranked by readiness score. Run locally:{" "}
            <code className="rounded bg-surface-raised px-1.5 py-0.5 text-xs">
              npm run repo:audit -- --limit 20
            </code>
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {ranked.length} audited · {all.length} total in catalog
          </p>
        </div>
        <RepoIntelligenceTable products={ranked} total={all.length} />
      </main>
    </div>
  );
}
