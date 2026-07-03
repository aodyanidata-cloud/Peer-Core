-- 0011_merchant_features — promotions, loyalty, reviews, scheduled orders, driver directory. Idempotent.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_minor integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_code text;

CREATE TABLE IF NOT EXISTS promotions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            text NOT NULL,
  kind            text NOT NULL,          -- 'percent' | 'amount'
  value           integer NOT NULL,       -- percent 0-100, or amount in minor units
  min_order_minor integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  max_redemptions integer,
  redeemed_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_promotions_code UNIQUE (tenant_id, code),
  CONSTRAINT ck_promotions_kind CHECK (kind IN ('percent','amount')),
  CONSTRAINT ck_promotions_value CHECK (value >= 0)
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  diner_phone  text NOT NULL,
  points       integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_loyalty_account UNIQUE (tenant_id, diner_phone)
);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  diner_phone  text NOT NULL,
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  delta        integer NOT NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating       integer NOT NULL,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_reviews_order UNIQUE (order_id),
  CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS driver_listings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  phone        text NOT NULL,
  areas        text,
  vehicle_type text,
  rate_note    text,
  verified     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['promotions','loyalty_accounts','loyalty_ledger','reviews','driver_listings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;
