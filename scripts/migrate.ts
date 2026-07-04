import { Pool } from 'pg';
import { applyMigrations } from '../src/db/migrate';
import { loadDotEnv } from '../src/load-env';

/**
 * Apply SQL migrations from ./drizzle to DATABASE_URL.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString });
  try {
    const applied = await applyMigrations(pool);
    console.log(`migrations applied: ${applied.join(', ')}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
