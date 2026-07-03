import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

/**
 * Lazily construct the Drizzle client. Connection is not opened until first use,
 * so `typecheck`/`build`/unit tests never require a live database.
 *
 * NOTE (Stage A1): this is connection wiring only. Per-request tenant context
 * (`set_config('app.current_tenant', ...)` in a transaction) and RLS enforcement
 * are task B1 (🔴) and must be added before any tenant-scoped query runs.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
