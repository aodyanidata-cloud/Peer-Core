-- 0003_catalog — generic, tenant-scoped catalog (B3). Idempotent.
-- Vertical-neutral: "items" with JSONB attributes; restaurant menus map onto this.
-- POS-compatible: external_ref + source let a PosProvider (Foodics, R3) sync cleanly.

CREATE TABLE IF NOT EXISTS catalog_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'active',
  external_ref text,
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id  uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  name         text NOT NULL,
  description  text,
  price_minor  integer NOT NULL DEFAULT 0,   -- integer MINOR units, never a float
  currency     text NOT NULL DEFAULT 'SAR',
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'available',
  external_ref text,
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_catalog_items_status CHECK (status IN ('available', 'sold_out', 'hidden')),
  CONSTRAINT ck_catalog_items_price_nonneg CHECK (price_minor >= 0)
);
CREATE INDEX IF NOT EXISTS ix_catalog_items_tenant ON catalog_items (tenant_id);
CREATE INDEX IF NOT EXISTS ix_catalog_categories_tenant ON catalog_categories (tenant_id);

-- RLS — every tenant-scoped table repeats the B1 pattern.
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_categories FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_categories_isolation ON catalog_categories;
CREATE POLICY catalog_categories_isolation ON catalog_categories
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_items_isolation ON catalog_items;
CREATE POLICY catalog_items_isolation ON catalog_items
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
