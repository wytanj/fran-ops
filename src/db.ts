import { Pool } from "pg";

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Db {
  query: Query;
  transaction<T>(fn: (query: Query) => Promise<T>): Promise<T>;
}

export function pgDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl });
  const query: Query = async (text, params = []) => {
    const result = await pool.query(text, params);
    return result.rows;
  };
  return {
    query,
    async transaction(fn) {
      const client = await pool.connect();
      const scoped: Query = async (text, params = []) => {
        const result = await client.query(text, params);
        return result.rows;
      };
      try {
        await client.query("begin");
        const value = await fn(scoped);
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
