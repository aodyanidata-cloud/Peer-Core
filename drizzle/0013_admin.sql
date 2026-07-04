-- 0013_admin — platform super-admin plane + auth/admin portals. Idempotent.

-- Platform admins: users who operate the platform-wide admin portal. Auth-plane
-- (no tenant_id), so no RLS — reached only through the auth service, like users
-- and sessions.
CREATE TABLE IF NOT EXISTS platform_admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
