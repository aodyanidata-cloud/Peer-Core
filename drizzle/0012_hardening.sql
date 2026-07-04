-- 0012_hardening — validation follow-ups. Idempotent.

-- Branch-level minimum order value (checkout guard).
ALTER TABLE branches ADD COLUMN IF NOT EXISTS min_order_minor integer NOT NULL DEFAULT 0;

-- memberships is auth-plane (read cross-tenant by user during authenticate, with
-- NO tenant context), so it can't take a plain tenant policy. A DUAL policy still
-- protects it: allow all rows when there is no tenant context (the auth read),
-- but scope to the tenant when a context IS set (any tenant-scoped query).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_dual ON memberships;
CREATE POLICY memberships_dual ON memberships
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

-- Driver ledger: one delivery + one earning per order (dedup / reassign semantics).
-- Postgres treats NULLs as distinct in a UNIQUE index, so settled rows whose
-- order_id was nulled don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_order ON deliveries (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_earnings_order ON driver_earnings (order_id);
