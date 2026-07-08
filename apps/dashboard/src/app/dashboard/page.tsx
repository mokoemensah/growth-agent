import {
  getActiveProducts,
  getMetrics,
  getPendingApprovals,
  getPipelineContacts,
  getSystemStatus,
  getWeeklyMetrics,
  groupContactsByColumn,
  PIPELINE_COLUMNS,
} from "@/lib/db";
import { ApprovalQueue } from "@/components/approval-queue";
import { DashboardNav } from "@/components/dashboard-nav";
import { GoalTracker } from "@/components/goal-tracker";
import { KillSwitch } from "@/components/kill-switch";
import { MetricsHeader } from "@/components/metrics-header";
import { PipelineBoard } from "@/components/pipeline-board";
import { ProductFilter } from "@/components/product-filter";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ product?: string }>;
}

export default async function DashboardHomePage({ searchParams }: PageProps) {
  const { product: productSlug } = await searchParams;

  const [contacts, approvals, metrics, weekly, system, products] = await Promise.all([
    getPipelineContacts(productSlug),
    getPendingApprovals(),
    getMetrics(),
    getWeeklyMetrics(),
    getSystemStatus(),
    getActiveProducts(),
  ]);

  const grouped = groupContactsByColumn(contacts);

  return (
    <div className="min-h-screen">
      <DashboardNav />
      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <MetricsHeader metrics={metrics} />
          <div className="flex flex-wrap items-center gap-4">
            <ProductFilter
              products={products.map((p) => ({ slug: p.slug, name: p.name }))}
              current={productSlug}
            />
            <KillSwitch initialPaused={system.outreachPaused} />
          </div>
        </div>
        <div className="grid gap-8 xl:grid-cols-[1fr_340px]">
          <PipelineBoard columns={PIPELINE_COLUMNS} grouped={grouped} />
          <div className="space-y-6">
            <GoalTracker weekly={weekly} />
            <ApprovalQueue approvals={approvals} />
          </div>
        </div>
      </main>
    </div>
  );
}
