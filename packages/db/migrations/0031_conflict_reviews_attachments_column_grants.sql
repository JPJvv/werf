-- Column-level UPDATE grants on `conflict_reviews` and `attachments` (sync-auditor pass,
-- 2026-08-17, sixteenth session). Same class of gap migration 0029 closed for `users`: both
-- tables granted `werf_app` a whole-row UPDATE with no column list, so the only thing stopping a
-- scoped write from rewriting evidence it should never touch again was "nothing does that today,"
-- not a grant. Narrowing UPDATE to exactly the columns real code sets is a convention made a
-- guarantee, the same shape as 0029 — INSERT and SELECT are untouched, since both genuinely need
-- the full column set at creation/read time.
--
-- `conflict_reviews`: `conflicts.service.ts`'s `markReviewed` is the only scoped UPDATE site,
-- and it sets exactly (status, review_note, reviewed_by, reviewed_at, updated_by, updated_at).
-- The evidentiary columns (kind, subject_id, field, fact_a_event_id, fact_b_event_id,
-- winner_event_id, rule) are written once, at INSERT, by `recordConflict`
-- (apps/api/src/common/conflict-review.ts) — "who said what, and which rule decided" — and must
-- never be rewritten after the fact.
REVOKE UPDATE ON "conflict_reviews" FROM werf_app;--> statement-breakpoint
GRANT UPDATE (
  status, review_note, reviewed_by, reviewed_at, updated_by, updated_at
) ON "conflict_reviews" TO werf_app;--> statement-breakpoint

-- `attachments`: `attachments.service.ts`'s two scoped UPDATE sites (the P1.2 revival-on-retry,
-- and `finalizeAttachment`'s pending-to-finalised transition) together touch exactly
-- (deleted_at, updated_at, status, updated_by). `object_key` and `checksum` are set once, at
-- INSERT, and must never be rewritten by a later scoped request — `finalizeAttachment` already
-- re-derives size/checksum from a real `headObject` call rather than trusting a client claim; a
-- column grant that let a client-facing UPDATE overwrite `object_key` after that check would
-- reopen exactly what that check exists to close. (The orphan sweep's own UPDATEs run on the
-- elevated connection, outside this grant, and are unaffected.)
REVOKE UPDATE ON "attachments" FROM werf_app;--> statement-breakpoint
GRANT UPDATE (
  deleted_at, updated_at, status, updated_by
) ON "attachments" TO werf_app;
