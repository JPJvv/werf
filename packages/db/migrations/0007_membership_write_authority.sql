-- Membership writes are an OWNER's act, and RLS must say so.
--
-- The gap this closes. The `farm_users_tenant` policy from 0001 scopes reads AND writes by
-- farm and nothing else:
--
--   USING (farm_id IN (SELECT app_user_farm_ids()))
--   WITH CHECK (farm_id IN (SELECT app_user_farm_ids()))
--
-- and `werf_app` holds `INSERT, UPDATE` on the table. Membership is where ROLE lives, so a
-- policy that checks only the farm means any member of that farm — a worker, the lowest
-- role we have — satisfies the WITH CHECK for a row that sets `role = 'owner'` on
-- themselves. The farm boundary holds; the authority boundary inside it does not exist.
--
-- Nothing exploits this today: every membership write in the API (`register`, `createFarm`,
-- `invite`, `acceptInvitation`) runs on the elevated connection and authorises the caller
-- in application code first. That is exactly what makes it worth fixing now rather than
-- later — RLS is supposed to be the layer that still holds when the application code is
-- wrong, and here it would not. One future endpoint doing a membership UPDATE through
-- `AppDb.asUser` is a self-service promotion to owner, and it would look like ordinary code.
--
-- Reads are deliberately UNCHANGED. Members must still see who else is on their farm, and
-- `assertMembership`/`assertRole` in FarmsService read this table through the scoped
-- connection to decide authorisation — narrowing USING would break that and, worse, would
-- make a non-owner's authorisation check silently return "no membership" instead of
-- "membership, wrong role".

-- The farms where the current user holds `owner`, on an accepted, unexpired membership.
-- SECURITY DEFINER for the same reason as `app_user_farm_ids()`: it reads `farm_users`,
-- and doing that under `farm_users`' own policy would recurse.
--
-- The conditions mirror `app_user_farm_ids()` exactly, and they must keep mirroring it: a
-- pending or expired owner membership is not authority, for the same reason it is not
-- access (0004).
CREATE OR REPLACE FUNCTION app_user_owned_farm_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT farm_id FROM farm_users
    WHERE user_id = app_current_user_id()
      AND role = 'owner'
      AND deleted_at IS NULL
      AND accepted_at IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now())
  $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_user_owned_farm_ids() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_owned_farm_ids() TO werf_app;--> statement-breakpoint

-- Split the single policy in two, because SELECT and the write commands now have different
-- predicates and one policy cannot express that. A permissive SELECT policy plus separate
-- INSERT/UPDATE policies is the standard shape for exactly this.
DROP POLICY IF EXISTS farm_users_tenant ON farm_users;--> statement-breakpoint

-- Read: unchanged — every membership row on a farm you belong to.
CREATE POLICY farm_users_read ON farm_users
  FOR SELECT
  USING (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

-- Write: only an owner of that farm, and only onto that farm.
CREATE POLICY farm_users_insert ON farm_users
  FOR INSERT
  WITH CHECK (farm_id IN (SELECT app_user_owned_farm_ids()));--> statement-breakpoint

-- Both halves are required and they are not the same check. USING decides which existing
-- rows this statement may touch; WITH CHECK decides what they may become. With USING alone
-- an owner could move a membership onto a farm they do not own; with WITH CHECK alone a
-- non-owner could rewrite a row they can see, as long as the result still named their farm.
CREATE POLICY farm_users_update ON farm_users
  FOR UPDATE
  USING (farm_id IN (SELECT app_user_owned_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_owned_farm_ids()));
