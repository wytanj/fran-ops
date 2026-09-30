import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Db, Query } from "../src/db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const migrationSql = readFileSync(join(root, "migrations", "001_bus.sql"), "utf8");

export async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(migrationSql);
  const query: Query = async (text, params = []) => {
    const result = await pg.query(text, params);
    return result.rows;
  };
  return {
    query,
    async transaction(fn) {
      return pg.transaction(async (tx) => {
        const scoped: Query = async (text, params = []) => {
          const result = await tx.query(text, params);
          return result.rows;
        };
        return fn(scoped);
      });
    },
  };
}
