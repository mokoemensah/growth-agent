import type { IcpFilter } from "../schemas/index.js";

export const DEFAULT_HERO_SLUG = "hvac-receptionist-agent";

/** Warmup schedule: week 1 → 5/day, week 2 → 10, week 3+ → 20 */
export const WARMUP_WEEKLY_CAPS = [5, 10, 20] as const;

export function getHeroProductSlug(): string {
  return process.env.HERO_PRODUCT_SLUG ?? DEFAULT_HERO_SLUG;
}

export function isHeroMode(): boolean {
  return process.env.HERO_MODE !== "false";
}

export const HVAC_ICP_FILTER: IcpFilter = {
  industries: ["hvac", "plumbing", "home services", "heating", "cooling", "contractor"],
  titles: ["Owner", "General Manager", "Operations Manager", "President", "COO"],
  minEmployees: 3,
  maxEmployees: 100,
  countries: ["United States"],
};

export function getHeroIcpFilter(): IcpFilter {
  if (!isHeroMode()) return {};
  const slug = getHeroProductSlug();
  if (slug === DEFAULT_HERO_SLUG) return HVAC_ICP_FILTER;
  return {};
}

export function warmupCapForWeek(weekIndex: number): number {
  const idx = Math.min(Math.max(weekIndex, 0), WARMUP_WEEKLY_CAPS.length - 1);
  return WARMUP_WEEKLY_CAPS[idx] ?? 5;
}
