-- One-time WebAuthn challenges (ADR-0007). The table DDL below is drizzle-generated; the
-- RLS block at the bottom is hand-authored, as always.
--
-- Why a table rather than a map in process memory: the challenge is the ONLY thing making
-- a passkey assertion un-replayable. The server names a random value, the authenticator
-- signs over it, and a signature for a challenge nobody issued — or issued once already —
-- is worthless. That property depends on the SERVER being the one that remembers. Held in
-- memory it would break as soon as there are two API instances (the finish request lands
-- on the node that never issued the challenge) and evaporate on every deploy. Both
-- failures present as "passkeys are flaky", which is the worst possible bug report.
--
-- Tenancy posture: identical to user_sessions — UNREACHABLE from the request path.
-- `werf_app` is granted NOTHING and RLS is enabled + FORCED with ZERO policies, so a
-- future accidental GRANT still yields no rows. @werf/sync classifies the table
-- 'server-only', so sync and RLS agree here by both saying "never".

CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_family_id" uuid,
	"challenge" text NOT NULL,
	"ceremony" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webauthn_challenges_user" ON "webauthn_challenges" USING btree ("user_id");--> statement-breakpoint

-- Consumed and expired rows are dead weight: nothing reads them and every one of them
-- slows the per-user scan that `consumeChallenge` does on the hot path. `user_sessions`
-- has the same index for the same reason (0003). The sweep that uses it is not written
-- yet — tracked in security.md §10.2.
CREATE INDEX "webauthn_challenges_expiry" ON "webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint

-- The ceremony a challenge was minted for is not decoration: a challenge issued to
-- register a NEW key must not be spendable as proof of an authentication, or the
-- enrolment flow becomes a login bypass. Constrained rather than merely documented,
-- because the check that matters is the one the database makes.
ALTER TABLE "webauthn_challenges"
  ADD CONSTRAINT "webauthn_challenges_ceremony_v1"
  CHECK ("ceremony" IN ('registration', 'authentication'));--> statement-breakpoint

-- ── webauthn_challenges: no policy, no grant, no access ──
-- FORCE matters even with no policy: without it the table owner would bypass RLS, and in
-- a small deployment the owner and the app role are easily the same principal (db.md).
ALTER TABLE "webauthn_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "webauthn_challenges" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON "webauthn_challenges" FROM werf_app;
