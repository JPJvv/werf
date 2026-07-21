-- TOTP replay guard: make a six-digit code single-use, like the recovery codes beside it.
--
-- A TOTP code is valid for its entire 30-second period, and our drift window widens that to
-- 90 seconds so a farmer in gloves with a drifting phone clock can still get in. That
-- tolerance is also a replay window: a code read over a shoulder, or left on a shared
-- office screen, works again for up to a minute and a half.
--
-- Recording the highest counter step ever accepted for a user, and refusing anything at or
-- below it, closes that without narrowing the window a legitimate user needs.
--
-- Additive and nullable, per db.md: NULL means "no code accepted yet", which is exactly the
-- state every existing row is in (nobody has enrolled — this ships in the same release as
-- enrolment itself). Nothing needs backfilling and no constraint tightens.

ALTER TABLE "users" ADD COLUMN "totp_last_used_step" bigint;
