-- 0008_lifecycle — reservation lifecycle/waitlist, complaints, notifications (R1.7-R1.11).
-- Idempotent.

-- Waitlist entries are reservations with no table yet.
ALTER TABLE reservations ALTER COLUMN table_id DROP NOT NULL;

-- Complaints (R1.9)
CREATE TABLE IF NOT EXISTS complaints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid REFERENCES branches(id) ON DELETE SET NULL,
  diner_phone text,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_complaints_status CHECK (status IN ('open','in_progress','resolved','closed'))
);

-- Notifications (R1.10)
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient   text NOT NULL,
  channel     text NOT NULL,
  event       text NOT NULL,
  body        text NOT NULL,
  dedupe_key  text,
  status      text NOT NULL DEFAULT 'sent',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
  ON notifications (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_optouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient   text NOT NULL,
  channel     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_optouts UNIQUE (tenant_id, recipient, channel)
);

-- RLS on the new tenant-scoped tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['complaints','notifications','notification_optouts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;
