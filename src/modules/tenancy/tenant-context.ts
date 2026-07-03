import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a transaction bound to `tenantId`'s Row-Level-Security context.
 *
 * The tenant id is set with `set_config(..., true)` — **transaction-local**, never
 * session-level — so it is safe under PgBouncer transaction pooling and cannot
 * leak into a reused connection.
 *
 * `tenantId` MUST be a server-derived value (from the authenticated session /
 * resolved tenant), never a client-supplied field. It is validated as a UUID
 * here as a defense-in-depth guard against injection into the GUC; the database
 * RLS policies are the authoritative isolation boundary.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error('withTenant: tenantId must be a valid UUID');
  }
  return db.transaction(async (tx) => {
    // set_config(name, value, is_local=true) — scoped to THIS transaction only.
    await tx.execute(
      sql`select set_config('app.current_tenant', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Run `fn` with NO tenant context set. RLS then fails closed (zero rows visible,
 * writes rejected). Exposed only so the safety suite can prove the closed-by-
 * default behavior; application code always goes through `withTenant`.
 */
export async function withoutTenant<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}
