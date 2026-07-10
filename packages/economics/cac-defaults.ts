import type { JSONValue } from "postgres";
import type { Db } from "../../apps/api/src/jobs/db.js";
import {
  DEFAULT_GLOBAL_CAC,
  parseGlobalCacDefaults,
  type GlobalCacDefaults,
} from "./cac.js";

const MEMORY_KEY = "cac_global_defaults";

export async function getGlobalCacDefaults(db: Db): Promise<GlobalCacDefaults> {
  const [row] = await db.sql<{ value: unknown }[]>`
    SELECT value FROM agent_memory
    WHERE namespace = 'system' AND key = ${MEMORY_KEY}
  `;
  return parseGlobalCacDefaults(row?.value);
}

export async function setGlobalCacDefaults(db: Db, defaults: GlobalCacDefaults): Promise<void> {
  await db.sql`
    INSERT INTO agent_memory (namespace, key, value)
    VALUES ('system', ${MEMORY_KEY}, ${db.sql.json(defaults as unknown as JSONValue)})
    ON CONFLICT (namespace, key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = now()
  `;
}

export { DEFAULT_GLOBAL_CAC, type GlobalCacDefaults };
