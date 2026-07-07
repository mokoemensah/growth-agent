export interface ProductRecord {
  id: string;
  slug: string;
  name: string;
  repo: string | null;
  description: string | null;
  status: "active" | "beta" | "paused" | "archived";
  landingPath: string | null;
  priceCents: number | null;
  billing: string | null;
  icpRules: IcpRules;
  /** Learned multiplier from close rates (default 1) */
  routerWeight?: number;
}

export interface IcpRules {
  industries?: string[];
  titles?: string[];
  keywords?: string[];
  minEmployees?: number;
  maxEmployees?: number;
  countries?: string[];
  excludeIndustries?: string[];
}

export interface RouteInput {
  industry: string | null;
  employeeCount: number | null;
  contactTitle: string | null;
  companyName: string | null;
  domain: string | null;
  description: string | null;
}

export interface RouteResult {
  product: ProductRecord;
  score: number;
  reasons: string[];
}

export function scoreProductFit(input: RouteInput, product: ProductRecord): RouteResult {
  const rules = product.icpRules;
  let score = 0;
  const reasons: string[] = [];

  const haystack = [
    input.industry,
    input.contactTitle,
    input.companyName,
    input.domain,
    input.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (rules.industries?.length) {
    const match = rules.industries.some((i) => haystack.includes(i.toLowerCase()));
    if (match) {
      score += 35;
      reasons.push(`Industry match for ${product.name}`);
    }
  }

  if (rules.keywords?.length) {
    const hits = rules.keywords.filter((k) => haystack.includes(k.toLowerCase()));
    if (hits.length > 0) {
      score += Math.min(25, hits.length * 10);
      reasons.push(`Keywords: ${hits.join(", ")}`);
    }
  }

  if (rules.titles?.length && input.contactTitle) {
    const title = input.contactTitle.toLowerCase();
    if (rules.titles.some((t) => title.includes(t.toLowerCase()))) {
      score += 20;
      reasons.push("Title match");
    }
  }

  if (input.employeeCount != null) {
    const min = rules.minEmployees ?? 0;
    const max = rules.maxEmployees ?? 10000;
    if (input.employeeCount >= min && input.employeeCount <= max) {
      score += 15;
      reasons.push("Company size in range");
    } else {
      score -= 15;
      reasons.push("Company size out of range");
    }
  }

  if (rules.excludeIndustries?.some((i) => haystack.includes(i.toLowerCase()))) {
    score = 0;
    reasons.push("Excluded industry");
  }

  const weight = product.routerWeight ?? 1;
  const weighted = Math.round(score * weight);
  return { product, score: Math.max(0, Math.min(100, weighted)), reasons };
}

export function routeLeadToProduct(
  input: RouteInput,
  products: ProductRecord[],
): RouteResult | null {
  const active = products.filter((p) => p.status === "active" || p.status === "beta");
  if (active.length === 0) return null;

  let best: RouteResult | null = null;
  for (const product of active) {
    const result = scoreProductFit(input, product);
    if (!best || result.score > best.score) {
      best = result;
    }
  }

  if (!best || best.score < 50) return null;
  return best;
}
