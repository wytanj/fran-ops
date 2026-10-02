import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Db, Query } from "../src/db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");

export const migrationSql = readFileSync(join(migrationsDir, "001_bus.sql"), "utf8");
export const staffDisplayMigrationSql = readFileSync(
  join(migrationsDir, "003_staff_display_name.sql"),
  "utf8",
);
export const billSplitMigrationSql = readFileSync(
  join(migrationsDir, "004_bill_split.sql"),
  "utf8",
);

function loadAllMigrations(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(migrationsDir, name), "utf8"));
}

export async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  for (const sql of loadAllMigrations()) {
    await pg.exec(sql);
  }
  const query: Query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
    const result = await pg.query(text, params);
    return result.rows as T[];
  };
  return {
    query,
    async transaction(fn) {
      return pg.transaction(async (tx) => {
        const scoped: Query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
          const result = await tx.query(text, params);
          return result.rows as T[];
        };
        return fn(scoped);
      });
    },
  };
}
