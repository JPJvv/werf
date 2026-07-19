-- Refresh-token sessions (ADR-0007). The table DDL below is drizzle-generated; the RLS
-- block at the bottom is hand-authored, as always.
--
-- Tenancy posture: this table is UNREACHABLE from the request path. `werf_app` — the
-- non-superuser role every authenticated API request runs as — is granted NOTHING here,
-- and RLS is enabled + FORCED with ZERO policies, so even a future accidental GRANT
-- still yields no rows. Only the elevated auth connection (a BYPASSRLS/superuser role,
-- the same one that runs migrations and provisions a business before any membership
-- exists) may touch it. Two independent locks, because one GRANT typo should not be the
-- difference between a leak and no leak.
--
-- @werf/sync classifies user_sessions as 'server-only', so it contributes no bucket and
-- no data query. Sync and RLS agree here by both saying "never".

CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"second_factor_at" timestamp with time zone,
	"active_farm_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"device_label" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_active_farm_id_farms_id_fk" FOREIGN KEY ("active_farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_sessions_user" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_family" ON "user_sessions" USING btree ("family_id");--> statement-breakpoint

-- Finding the session for a presented refresh token is the hot path on every refresh;
-- the UNIQUE constraint on refresh_token_hash already indexes it. This one covers the
-- sweep that expires old sessions.
CREATE INDEX "user_sessions_expiry" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint

-- ── user_sessions: no policy, no grant, no access ──
-- FORCE matters even with no policy: without it the table owner would bypass RLS, and in
-- a small deployment the owner and the app role are easily the same principal (db.md).
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "user_sessions" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON "user_sessions" FROM werf_app;