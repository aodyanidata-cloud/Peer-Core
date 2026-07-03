import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
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

// ─── Identity plane (B2) ──────────────────────────────────────────────────────
// Auth-plane tables. Not tenant-scoped data: this is where tenant/role authority
// is RESOLVED (a user's memberships), so it is reached only through the auth
// service, never from tenant-scoped request handling.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A user's role within a tenant. The sole source of tenant/role authority. */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'owner' | 'staff' — enforced by a CHECK constraint
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqUserTenant: unique('uq_memberships_user_tenant').on(t.userId, t.tenantId),
  }),
);

export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Catalog (B3) — generic, tenant-scoped, POS-compatible ───────────────────

export const catalogCategories = pgTable('catalog_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  status: text('status').notNull().default('active'),
  externalRef: text('external_ref'),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const catalogItems = pgTable('catalog_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => catalogCategories.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  description: text('description'),
  priceMinor: integer('price_minor').notNull().default(0),
  currency: text('currency').notNull().default('SAR'),
  attributes: jsonb('attributes').notNull().default({}),
  status: text('status').notNull().default('available'),
  externalRef: text('external_ref'),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
