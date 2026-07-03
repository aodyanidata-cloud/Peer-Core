import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closeDb } from '../src/db';

/**
 * Apply Drizzle migrations from ./drizzle. No migrations exist at Stage A1
 * (the schema is intentionally empty until B1); this harness is here so the
 * migration path is wired and ready.
 */
async function main(): Promise<void> {
  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('migrations applied');
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
