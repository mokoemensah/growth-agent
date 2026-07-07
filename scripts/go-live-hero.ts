#!/usr/bin/env tsx
/** Apply hero-product migration + verify */

import { config } from "dotenv";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

config({ path: resolve(process.cwd(), ".env") });

const migrate = spawnSync("npm", ["run", "db:migrate"], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const check = spawnSync("npm", ["run", "go-live:check"], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

process.exit(check.status ?? 0);
