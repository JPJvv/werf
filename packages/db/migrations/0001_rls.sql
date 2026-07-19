-- Row-Level Security for the identity & tenancy core.
--
-- These policies MUST agree with the PowerSync sync rules derived from the `TENANCY`
-- registry in @werf/sync (see packages/sync/src/index.ts). Sync and RLS are two systems
-- with one invariant and a SILENT failure mode: a permissive sync rule leaks across farms
-- even when every policy here is perfect. Change one, change both; the tenancy suite guards it.
--
-- The application connects as the NON-superuser role `werf_app`, which is subject to RLS.
-- Provisioning that must run before a membership exists (register a business, create the
-- first farm) uses an elevated path (a superuser/owner connection) that bypasses RLS on
-- purpose — that path is the auth service's, built in the auth slice.

-- The app role. NOLOGIN here; the deployment grants LOGIN + a password out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'werf_app') THEN
    CREATE ROLE werf_app NOLOGIN;
  END IF;
END $$;--> statement-breakpoint

-- The current request's user id, from the GUC the app sets per transaction. Empty/unset
-- yields NULL, so an unauthenticated connection sees nothing rather than erroring.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;--> statement-breakpoint

-- The farms the current user is an active member of. SECURITY DEFINER so it reads
-- farm_users WITHOUT triggering farm_users' own RLS — that would recurse. This one
-- function is the tenancy predicate every policy below is built on.
CREATE OR REPLACE FUNCTION app_user_farm_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT farm_id FROM farm_users
    WHERE user_id = app_current_user_id()
      AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_user_farm_ids() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user_id(), app_user_farm_ids() TO werf_app;--> statement-breakpoint

-- Domain access. No hard DELETE is granted — deletion is UPDATE ... SET deleted_at.
GRANT USAGE ON SCHEMA public TO werf_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  businesses, farms, users, user_passkeys, farm_users, enterprises TO werf_app;--> statement-breakpoint

-- ── businesses: visible if the user belongs to a farm the business owns ──
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY businesses_tenant ON businesses
  USING (id IN (SELECT business_id FROM farms WHERE id IN (SELECT app_user_farm_ids())))
  WITH CHECK (id IN (SELECT business_id FROM farms WHERE id IN (SELECT app_user_farm_ids())));--> statement-breakpoint

-- ── farms: visible for farms the user is a member of ──
ALTER TABLE farms ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE farms FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY farms_tenant ON farms
  USING (id IN (SELECT app_user_farm_ids()))
  WITH CHECK (id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

-- ── users: yourself, plus co-members of a farm you share ──
ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY users_self_and_comembers ON users
  USING (
    id = app_current_user_id()
    OR EXISTS (
      SELECT 1 FROM farm_users fu
      WHERE fu.user_id = users.id
        AND fu.deleted_at IS NULL
        AND fu.farm_id IN (SELECT app_user_farm_ids())
    )
  )
  WITH CHECK (id = app_current_user_id());--> statement-breakpoint

-- ── user_passkeys: only your own. Server-only for SYNC; RLS still scopes API reads. ──
ALTER TABLE user_passkeys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE user_passkeys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY user_passkeys_owner ON user_passkeys
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint

-- ── farm_users: membership rows for farms you belong to ──
ALTER TABLE farm_users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE farm_users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY farm_users_tenant ON farm_users
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

-- ── enterprises: farm-scoped ──
ALTER TABLE enterprises ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE enterprises FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY enterprises_tenant ON enterprises
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));
