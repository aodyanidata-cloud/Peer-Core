-- 0001_rls — Row-Level Security. Idempotent (safe to re-run).
-- The isolation boundary for every tenant-scoped table. tenant_settings is the
-- first; every future tenant-scoped table repeats this exact pattern.

-- Current tenant from the transaction-local GUC set by withTenant().
-- Returns NULL when unset -> `tenant_id = NULL` is NULL -> no rows -> FAIL CLOSED.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_tenant', true), '')::uuid
$$;

-- ENABLE turns RLS on; FORCE makes it apply even to the table OWNER (app_user
-- owns these tables). Without FORCE the owner would silently bypass isolation.
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_settings_isolation ON tenant_settings;
CREATE POLICY tenant_settings_isolation ON tenant_settings
  USING      (tenant_id = current_tenant_id())   -- what rows are visible / affectable
  WITH CHECK (tenant_id = current_tenant_id());   -- what rows may be written: a
                                                  -- client-supplied tenant_id that
                                                  -- differs from the context is rejected

-- NOTE: `tenants` is the admin-plane registry (the tenant DIMENSION, not
-- tenant-scoped DATA), so it is intentionally NOT under tenant RLS. Tenant
-- creation/lookup is a privileged onboarding/admin path (owned by B2 auth +
-- the admin console), never reached from tenant-scoped request handling.
