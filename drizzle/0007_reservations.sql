-- 0007_reservations — reservations with ATOMIC double-booking prevention (R1.6).
-- Idempotent. The exclusion constraint is the real guarantee: two overlapping
-- active reservations for the same table cannot both commit, even under
-- concurrency — the database rejects the second, no app-level lock needed.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  table_id     uuid NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
  party_size   integer NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'confirmed',
  diner_name   text,
  diner_phone  text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_reservations_party CHECK (party_size > 0),
  CONSTRAINT ck_reservations_window CHECK (ends_at > starts_at),
  CONSTRAINT ck_reservations_status CHECK (
    status IN ('requested','confirmed','seated','completed','cancelled','no_show','waitlisted')
  )
);
CREATE INDEX IF NOT EXISTS ix_reservations_branch ON reservations (branch_id);

-- No two ACTIVE (confirmed/seated) reservations for the same table may overlap in time.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS ex_reservations_no_overlap;
ALTER TABLE reservations ADD CONSTRAINT ex_reservations_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('confirmed', 'seated'));

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservations_isolation ON reservations;
CREATE POLICY reservations_isolation ON reservations
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
