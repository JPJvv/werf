-- Membership acceptance: an invitation grants nothing until the invitee agrees.
--
-- Without this, `invite` is a one-sided act with cross-tenant consequences. Naming any
-- email address makes that person a co-member, and the `users_self_and_comembers` policy
-- from 0001 then discloses their real name, phone, locale and last_seen_at to whoever
-- invited them — PII belonging to someone in another tenant who never agreed to share it.
-- The `users` table is farm-scoped in the sync registry too, so those rows would replicate
-- onto the inviter's device. POPIA makes an owner's unilateral choice of whose PII to
-- acquire our problem, not theirs.
--
-- Additive, per db.md: both columns are nullable, existing rows are backfilled as accepted
-- (they are all self-created owner memberships), and the predicate change lands in the
-- same release as the column it reads — nothing in flight can violate it.

ALTER TABLE "farm_users" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "farm_users" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint

-- Every membership that exists today was created by the person it belongs to — registering
-- a business, or adding a farm to one you already own. Consent is not in question when you
-- are inviting yourself, so these are accepted as of their creation.
UPDATE "farm_users" SET "accepted_at" = "created_at" WHERE "accepted_at" IS NULL;--> statement-breakpoint

-- The tenancy predicate every RLS policy is built on now ignores pending invitations.
-- This is the line that makes the column mean something: until it is accepted, an
-- invitation is a request, not an access grant.
CREATE OR REPLACE FUNCTION app_user_farm_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT farm_id FROM farm_users
    WHERE user_id = app_current_user_id()
      AND deleted_at IS NULL
      AND accepted_at IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now())
  $$;--> statement-breakpoint

-- The co-member half of the users policy needs the same condition, and this is the line
-- that actually closes the disclosure. `app_user_farm_ids()` above governs which farms the
-- VIEWER may see through; it says nothing about the membership that makes the TARGET a
-- co-member. Without `accepted_at IS NOT NULL` here, an owner invites any address and the
-- pending row alone makes that person's name, phone, locale and last_seen_at readable —
-- and syncable to the owner's device — before they have agreed to anything.
DROP POLICY IF EXISTS users_self_and_comembers ON users;--> statement-breakpoint
CREATE POLICY users_self_and_comembers ON users
  USING (
    id = app_current_user_id()
    OR EXISTS (
      SELECT 1 FROM farm_users fu
      WHERE fu.user_id = users.id
        AND fu.deleted_at IS NULL
        AND fu.accepted_at IS NOT NULL
        AND fu.farm_id IN (SELECT app_user_farm_ids())
    )
  )
  WITH CHECK (id = app_current_user_id());
