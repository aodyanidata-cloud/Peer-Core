import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * Apply the raw SQL migrations in ./drizzle in filename order. Each file is
 * idempotent, so re-running is safe (used directly by the safety suite's setup).
 * Multi-statement SQL is sent over the simple query protocol (no bound params).
 */
export async function applyMigrations(
  pool: Pool,
  dir: string = join(__dirname, '..', '..', 'drizzle'),
): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const ddl = readFileSync(join(dir, file), 'utf8');
    await pool.query(ddl);
  }
  return files;
}
