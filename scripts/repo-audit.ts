#!/usr/bin/env tsx
/**
 * Cheap repo intelligence pass — harvest + LLM audit → products.metadata.intelligence
 *
 * Usage:
 *   npm run repo:audit -- --limit 20
 *   npm run repo:audit -- --active-only
 *   npm run repo:audit -- --slug boswell-saas
 *   npm run repo:audit -- --force
 *
 * Cost savers: skips unchanged snapshots, archived repos (no LLM), thin repos (heuristic).
 * Default model: Gemini Flash (~$0.01/repo). Set REPO_AUDIT_MODEL=z-ai/glm-5.2 for GLM.
 */
import "dotenv/config";
import { resolve } from "node:path";
import { createDb } from "../apps/api/src/jobs/db.js";
import { auditSnapshot, harvestRepo } from "../packages/repo-intelligence/index.js";
import type { RepoIntelligenceRecord } from "../packages/repo-intelligence/types.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const limit = Number(arg("--limit") ?? "20");
  const onlySlug = arg("--slug");
  const force = hasFlag("--force");
  const activeOnly = hasFlag("--active-only");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");

  const db = createDb(url);
  const products = await db.products.list();
  let targets = products.filter((p) => p.repo?.includes("/"));

  if (activeOnly) {
    targets = targets.filter((p) => p.status === "active" || p.status === "beta");
  }

  if (onlySlug) {
    targets = targets.filter((p) => p.slug === onlySlug);
  }

  targets = targets
    .filter((p) => {
      if (force) return true;
      const intel = p.metadata.intelligence as RepoIntelligenceRecord | undefined;
      return !intel?.auditedAt;
    })
    .slice(0, limit);

  if (targets.length === 0) {
    console.log("No products to audit (use --force to re-run).");
    await db.sql.end();
    return;
  }

  console.log(
    `Auditing ${targets.length} repos (limit ${limit}${activeOnly ? ", active only" : ""})…`,
  );

  let totalCost = 0;
  let ok = 0;
  let skipped = 0;

  const root = resolve(import.meta.dirname, "..");

  for (const product of targets) {
    const repo = product.repo!;
    try {
      const snapshot = harvestRepo(repo, product.slug, product.name, {
        description: product.description,
        laymanPitch: product.laymanPitch,
        docsRoot: root,
      });
      const prior = product.metadata.intelligence as RepoIntelligenceRecord | undefined;
      if (!force && prior?.snapshotHash === snapshot.snapshotHash) {
        console.log(`= ${product.slug} unchanged`);
        skipped += 1;
        continue;
      }

      const intel = await auditSnapshot(snapshot);
      await db.products.updateIntelligence(product.id, intel);
      totalCost += intel.costUsd;

      if (!product.laymanPitch?.trim() && intel.report.whatItDoes.length >= 20) {
        await db.products.updateLaymanPitch(product.id, intel.report.whatItDoes.slice(0, 400));
      }

      console.log(
        `✓ ${product.slug} readiness=${intel.scores.readinessScore} channel=${intel.recommendedChannel} $${intel.costUsd.toFixed(4)}`,
      );
      ok += 1;
    } catch (err) {
      console.warn(`✗ ${product.slug}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done. audited=${ok} skipped=${skipped} est_cost=$${totalCost.toFixed(4)}`);
  await db.sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
