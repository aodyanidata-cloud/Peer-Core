import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  doublePrecision,
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

// ─── Tool dispatcher (B4) — idempotency + audit ──────────────────────────────

export const toolInvocations = pgTable('tool_invocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tool: text('tool').notNull(),
  idempotencyKey: text('idempotency_key'),
  actorUserId: uuid('actor_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  args: jsonb('args').notNull().default({}),
  status: text('status').notNull().default('pending'),
  result: jsonb('result'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// ─── Knowledge base (B6) — tenant-scoped RAG source ──────────────────────────

export const kbDocuments = pgTable('kb_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('manual'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  embedding: jsonb('embedding').$type<number[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Restaurants vertical (R1) ───────────────────────────────────────────────

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  hours: jsonb('hours').notNull().default({}),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const restaurantTables = pgTable('restaurant_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull(),
  area: text('area'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const menuAvailability = pgTable(
  'menu_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => catalogItems.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    available: boolean('available').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqItemBranch: unique('uq_menu_availability').on(t.itemId, t.branchId),
  }),
);

/**
 * Reservations. Atomic double-booking prevention is enforced by an exclusion
 * constraint in the 0007 migration (ex_reservations_no_overlap), not in app code.
 */
export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').references(() => restaurantTables.id, {
    onDelete: 'cascade',
  }), // nullable: waitlist entries have no table yet
  partySize: integer('party_size').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('confirmed'),
  dinerName: text('diner_name'),
  dinerPhone: text('diner_phone'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Lifecycle: complaints + notifications (R1.9/R1.10) ──────────────────────

export const complaints = pgTable('complaints', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, {
    onDelete: 'set null',
  }),
  dinerPhone: text('diner_phone'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  recipient: text('recipient').notNull(),
  channel: text('channel').notNull(),
  event: text('event').notNull(),
  body: text('body').notNull(),
  dedupeKey: text('dedupe_key'),
  status: text('status').notNull().default('sent'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationOptouts = pgTable(
  'notification_optouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    channel: text('channel').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqOptout: unique('uq_notification_optouts').on(
      t.tenantId,
      t.recipient,
      t.channel,
    ),
  }),
);
