-- 0009_orders — ordering + two-phase money loop (R2). Idempotent.
-- The money core: server-computed totals, an order state machine, and payments
-- (authorize -> capture/void/refund) behind a provider contract. All tenant-scoped.

CREATE TABLE IF NOT EXISTS orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  order_type        text NOT NULL,
  subtotal_minor    integer NOT NULL,
  vat_minor         integer NOT NULL,
  delivery_fee_minor integer NOT NULL DEFAULT 0,
  total_minor       integer NOT NULL,
  currency          text NOT NULL DEFAULT 'SAR',
  status            text NOT NULL DEFAULT 'NEW',
  payment_status    text NOT NULL DEFAULT 'authorized',
  payment_ref       text,
  idempotency_key   text,
  diner_phone       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_orders_type CHECK (order_type IN ('delivery','pickup','dinein')),
  CONSTRAINT ck_orders_status CHECK (status IN
    ('NEW','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','PICKED_UP','DELIVERED','COMPLETE','REJECTED','CANCELLED')),
  CONSTRAINT ck_orders_pay CHECK (payment_status IN ('authorized','captured','voided','refunded')),
  CONSTRAINT ck_orders_money CHECK (subtotal_minor >= 0 AND vat_minor >= 0 AND total_minor >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idem
  ON orders (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id          uuid REFERENCES catalog_items(id) ON DELETE SET NULL,
  name             text NOT NULL,              -- snapshot at order time
  unit_price_minor integer NOT NULL,           -- snapshot base price
  quantity         integer NOT NULL,
  modifiers        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- snapshot {name,priceDeltaMinor}
  line_total_minor integer NOT NULL,
  CONSTRAINT ck_order_items_qty CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action       text NOT NULL,
  amount_minor integer NOT NULL,
  provider     text NOT NULL DEFAULT 'fake',
  provider_ref text,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_payments_action CHECK (action IN ('authorize','capture','void','refund'))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_items','order_events','payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;
