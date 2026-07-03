import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Tenants — the root tenant registry. NOT tenant-scoped itself (it IS the tenant
 * dimension). Row-Level Security guards every table that references it.
 */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tenant settings — the first tenant-scoped table and the canonical carrier of
 * B1's RLS enforcement. Every row belongs to exactly one tenant; RLS (ENABLEd +
 * FORCEd, see the 0001_rls migration) makes a row invisible and unwritable
 * outside its own tenant context, regardless of any client-supplied tenant_id.
 */
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqTenantKey: unique('uq_tenant_settings_tenant_key').on(t.tenantId, t.key),
  }),
);
