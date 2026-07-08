import { createDb } from "../../../api/src/jobs/db";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return createDb(url);
}

export type {
  PipelineContact,
  ApprovalItem,
  DashboardMetrics,
  WeeklyMetrics,
  ProductRow,
} from "./queries";
export type { GlobalCacDefaults } from "../../../../packages/economics/cac-defaults";
export {
  getPipelineContacts,
  getPendingApprovals,
  getMetrics,
  getWeeklyMetrics,
  getActivities,
  getContactById,
  getSystemStatus,
  getProducts,
  getProductBySlug,
  getActiveProducts,
  getGlobalCacDefaults,
  getRepoIntelligenceProducts,
  groupContactsByColumn,
  PIPELINE_COLUMNS,
} from "./queries";
