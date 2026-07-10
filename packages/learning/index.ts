export {
  applySubjectVariant,
  ensureSubjectLineExperiment,
  pickSubjectVariant,
  recordVariantImpression,
  recordReplyConversion,
  promoteExperimentWinners,
  MIN_VARIANT_IMPRESSIONS,
  type SubjectVariant,
} from "./experiments.js";

export { calibrateAllProductCac, calibrateProductCac } from "./cac-calibration.js";
export { updateRouterWeightsFromCloses, routerWeightFromMetadata } from "./router-weights.js";
export { collectPeriodMetrics, type PeriodMetrics } from "./metrics.js";
export { runWeeklyLearning, type WeeklyLearningResult } from "./weekly.js";
