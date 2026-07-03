-- 0004_tool_invocations — tool-dispatcher idempotency + audit (B4). Idempotent.

CREATE TABLE IF NOT EXISTS tool_invocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool            text NOT NULL,
  idempotency_key text,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  args            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending',
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT ck_tool_invocations_status CHECK (status IN ('pending', 'completed', 'failed'))
);

-- One completed/pending row per (tenant, idempotency key). Race-safe: a second
-- concurrent dispatch with the same key hits this constraint instead of double-running.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_invocations_idem
  ON tool_invocations (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_invocations_isolation ON tool_invocations;
CREATE POLICY tool_invocations_isolation ON tool_invocations
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
