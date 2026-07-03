/**
 * Seed script — placeholder at Stage A1.
 *
 * There is no schema to seed yet (tenants, menus, etc. arrive with B1/B3/R1.x).
 * Kept as the wired entry point so `npm run seed` exists from day one.
 */
async function main(): Promise<void> {
  console.log('nothing to seed yet (Stage A1 — empty schema).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
