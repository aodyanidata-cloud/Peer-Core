-- 0006_restaurants — Restaurants vertical domain (R1.1/R1.2). Idempotent.
-- Vertical tables live here; the engine core stays generic. All tenant-scoped
-- with the same B1 RLS pattern. Menu items reuse the generic catalog (B3);
-- these add branches, tables (for reservations), and per-branch availability.

CREATE TABLE IF NOT EXISTS branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text,
  lat         double precision,
  lng         double precision,
  hours       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { mon: [["09:00","23:00"]], ... }
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  capacity    integer NOT NULL,
  area        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_restaurant_tables_capacity CHECK (capacity > 0)
);
CREATE INDEX IF NOT EXISTS ix_restaurant_tables_branch ON restaurant_tables (branch_id);

CREATE TABLE IF NOT EXISTS menu_availability (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  available   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_menu_availability UNIQUE (item_id, branch_id)
);

-- RLS on every vertical table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','restaurant_tables','menu_availability'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;
