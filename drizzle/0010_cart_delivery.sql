-- 0010_cart_delivery — persistent cart + delivery/driver-earnings ledger (R2). Idempotent.

CREATE TABLE IF NOT EXISTS carts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_carts_status CHECK (status IN ('active','checked_out','abandoned'))
);

CREATE TABLE IF NOT EXISTS cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cart_id     uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  quantity    integer NOT NULL,
  modifiers   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_cart_items_qty CHECK (quantity > 0)
);

-- Lightweight, restaurant-owned delivery (platform tracks; never pays the driver).
CREATE TABLE IF NOT EXISTS deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_name  text NOT NULL,
  driver_phone text NOT NULL,
  status       text NOT NULL DEFAULT 'assigned',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_deliveries_status CHECK (status IN ('assigned','picked_up','delivered','failed'))
);

-- Shared ledger of what the RESTAURANT owes the driver (settled off-platform).
CREATE TABLE IF NOT EXISTS driver_earnings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_phone text NOT NULL,
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  amount_minor integer NOT NULL,
  settled      boolean NOT NULL DEFAULT false,
  settled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_driver_earnings_amount CHECK (amount_minor >= 0)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['carts','cart_items','deliveries','driver_earnings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;
