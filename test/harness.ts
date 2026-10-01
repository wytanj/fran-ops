import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Db, Query } from "../src/db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const migrationSql = readFileSync(join(root, "migrations", "001_bus.sql"), "utf8");
export const staffDisplayMigrationSql = readFileSync(
  join(root, "migrations", "003_staff_display_name.sql"),
  "utf8",
);

export async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(migrationSql);
  await pg.exec(staffDisplayMigrationSql);
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