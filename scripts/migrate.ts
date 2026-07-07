#!/usr/bin/env tsx
/** Run all SQL migrations in order */

import { config } from "dotenv";
import { resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

config({ path: resolve(process.cwd(), ".env") });

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../db/migrations");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, {
    ssl: databaseUrl.includes("neon.tech") ? "require" : undefined,
  });

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const [existing] = await sql`
      SELECT filename FROM schema_migrations WHERE filename = ${file}
    `;
    if (existing) {
      console.log(`skip  ${file}`);
      continue;
    }

    const content = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`apply ${file}`);
    await sql.unsafe(content);
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
  }

  console.log("Migrations complete");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
