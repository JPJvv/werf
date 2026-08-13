/**
 * Attachment vocabulary (phase-checklists.md 3i). One shared local-first attachment queue for
 * animal photos today and crop/grievance documents later (offline-sync.md § 3.1) — a single
 * `attachments` metadata table with a `subjectType` discriminator, rather than a new table per
 * entity kind. Adding a subject type is a code release AND a migration (`ALTER TYPE ... ADD
 * VALUE`), the same posture `events.ts`'s `EVENT_TYPES` documents for the identical reason: this
 * app half and the Postgres enum it drives in `@werf/db` must not drift.
 */

/** What kind of entity an attachment belongs to. Grows over phases; never shrinks. */
export const ATTACHMENT_SUBJECT_TYPES = ['animal'] as const;

/**
 * `pending`: metadata committed locally/server-side, the binary has not been durably
 * acknowledged yet. `finalised`: the server has verified the uploaded object's size and checksum
 * against this row and will never re-verify it. There is no third state — a checksum mismatch or
 * a refused upload leaves the row `pending` forever rather than inventing a `failed` status
 * (offline-sync.md: "Upload is idempotent by attachment id and checksum", so a retry from
 * `pending` is always safe and always the same request).
 */
export const ATTACHMENT_STATUSES = ['pending', 'finalised'] as const;
