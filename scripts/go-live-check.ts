#!/usr/bin/env tsx
/** Pre-flight checks before turning off MOCK_INTEGRATIONS */

import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import { getHeroProductSlug } from "../packages/hero-config/index.js";

config({ path: resolve(process.cwd(), ".env") });

const REQUIRED_ALWAYS = ["DATABASE_URL"] as const;
const REQUIRED_LIVE = [
  "OPENROUTER_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;

async function main(): Promise<void> {
  const mock = process.env.MOCK_INTEGRATIONS === "true";
  const hero = getHeroProductSlug();

  console.log(`\n🎯 Hero product: ${hero}`);
  console.log(`   Mode: ${mock ? "MOCK (safe)" : "LIVE (real sends)"}\n`);

  let failed = 0;

  for (const key of REQUIRED_ALWAYS) {
    if (!process.env[key]) {
      console.log(`❌ ${key} — missing`);
      failed += 1;
    } else {
      console.log(`✅ ${key}`);
    }
  }

  if (!mock) {
    console.log("\nLive integration keys:");
    for (const key of REQUIRED_LIVE) {
      if (!process.env[key]) {
        console.log(`❌ ${key} — missing`);
        failed += 1;
      } else {
        console.log(`✅ ${key}`);
      }
    }

    if (process.env.SERPER_API_KEY) {
      console.log("✅ Lead source: Serper (Google Places)");
    } else if (process.env.APOLLO_API_KEY) {
      console.log("✅ Lead source: Apollo");
    } else {
      console.log("❌ Lead source — set SERPER_API_KEY or APOLLO_API_KEY");
      failed += 1;
    }
  } else {
    console.log("\n⏭️  Skipping Resend/Serper/OpenRouter (MOCK_INTEGRATIONS=true)");
  }

  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = postgres(url, { ssl: url.includes("neon.tech") ? "require" : undefined });
    try {
      const [heroRow] = await sql<{ slug: string; status: string }[]>`
        SELECT slug, status::text FROM products WHERE slug = ${hero}
      `;
      if (!heroRow) {
        console.log(`❌ Hero product "${hero}" not in database — run npm run db:migrate`);
        failed += 1;
      } else if (heroRow.status !== "active") {
        console.log(`❌ Hero product status is "${heroRow.status}" — expected active`);
        failed += 1;
      } else {
        console.log(`✅ Hero product active in DB`);
      }

      const [cap] = await sql<{ value: number }[]>`
        SELECT value FROM agent_memory WHERE namespace = 'system' AND key = 'daily_send_cap'
      `;
      console.log(`✅ Daily send cap: ${cap?.value ?? "default (10)"}`);

      const activeCount = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM products WHERE status = 'active'
      `;
      const n = Number(activeCount[0]?.count ?? 0);
      if (n > 1) {
        console.log(`⚠️  ${n} active products — hero mode expects 1. Run migration 007.`);
      } else {
        console.log(`✅ ${n} active product (focused)`);
      }
    } finally {
      await sql.end();
    }
  }

  if (failed > 0) {
    console.log(`\n❌ ${failed} check(s) failed.\n`);
    process.exit(1);
  }

  if (mock) {
    console.log("\n✅ Ready for mock runs. Set MOCK_INTEGRATIONS=false on Render when keys are set.\n");
  } else {
    console.log("\n✅ Ready for live outreach. Start with 5 sends/day (warmup cap).\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
