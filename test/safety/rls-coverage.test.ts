import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { applyMigrations } from '../../src/db/migrate';

/**
 * RLS COVERAGE (🔴) — structural guarantee that EVERY table carrying tenant_id
 * has RLS both ENABLEd and FORCEd with at least one policy. This catches the
 * "future table forgot FORCE RLS" gap the single-table isolation suite can't.
 */
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('RLS coverage — every tenant table is FORCEd', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('all tables with a tenant_id column have RLS enabled + forced + a policy', async () => {
    const { rows } = await pool.query<{
      relname: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id')
      ORDER BY c.relname
    `);

    expect(rows.length).toBeGreaterThan(15); // sanity: we have many tenant tables
    const offenders = rows.filter(
      (r) => !r.rls || !r.forced || r.policies < 1,
    );
    expect(
      offenders,
      `tenant tables missing FORCEd RLS + policy: ${offenders
        .map((o) => o.relname)
        .join(', ')}`,
    ).toEqual([]);
  });
});
