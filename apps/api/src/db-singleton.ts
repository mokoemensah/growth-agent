import { createDb, type Db } from "./jobs/db.js";

let dbInstance: Db | null = null;

export function getDb(): Db {
  if (!dbInstance) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    dbInstance = createDb(databaseUrl);
  }
  return dbInstance;
}
