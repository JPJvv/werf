/**
 * Entity schemas for the identity & tenancy core: Business, Farm, User, FarmUser,
 * Enterprise (FR-001..005). These are the single source of truth for validation —
 * client and server validate with the identical object, and TS types are derived
 * with `z.infer`, never hand-written.
 *
 * Two shapes per entity:
 *   - the *record* schema: a persisted row as it comes back from the server, with
 *     server-owned audit timestamps.
 *   - the *new* schema: what a client composes offline to create the row. The id is
 *     present because IDs are client-generated UUIDv7 (the client cannot ask a
 *     sequence for one); audit timestamps are the server's to write.
 *
 * Secrets never appear here. `users.password_hash`, `totp_secret_encrypted` and
 * `recovery_codes_hashed` live only in @werf/db and never cross the wire in a shared
 * schema — a breach of a shared type should reveal nothing an attacker can use.
 */

import { z } from 'zod';
import {
  auditTimestampsSchema as auditTimestamps,
  enterpriseTypeSchema,
  jurisdictionSchema,
  timestampSchema,
  userRoleSchema,
  uuidSchema,
} from './primitives';

/** BCP-47 locale tags we ship. Locale lives on the USER, never the farm or browser (FR-008). */
export const SUPPORTED_LOCALES = ['en-ZA', 'af-ZA'] as const;
export const localeSchema = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof localeSchema>;

/**
 * Theme is 'system' at the schema level — the DB and API vocabulary. The client maps
 * 'system' to "Match my phone" and only follows `prefers-color-scheme` when explicitly
 * chosen; the default stays light (a deliberate product decision, see CLAUDE.md).
 */
export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

// ── Business ────────────────────────────────────────────────────────────────
// The account root. One business owns many farms (FR-001, FR-004).

export const businessSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  registrationNumber: z.string().min(1).nullable(),
  vatNumber: z.string().min(1).nullable(),
  ...auditTimestamps,
});
export type Business = z.infer<typeof businessSchema>;

export const newBusinessSchema = businessSchema.pick({ id: true, name: true }).extend({
  registrationNumber: businessSchema.shape.registrationNumber.default(null),
  vatNumber: businessSchema.shape.vatNumber.default(null),
});
export type NewBusiness = z.infer<typeof newBusinessSchema>;

// ── Farm ────────────────────────────────────────────────────────────────────
// The unit of tenancy AND of jurisdiction. `enterprise_types` drives the whole UI
// (FR-017). `jurisdiction` is the law the farm operates under — from the FARM, never
// the user or the browser — and is locked to 'ZA' in v1 (FR-018, ADR-0006).

export const farmSchema = z.object({
  id: uuidSchema,
  businessId: uuidSchema,
  name: z.string().min(1),
  jurisdiction: jurisdictionSchema,
  province: z.string().min(1),
  district: z.string().min(1).nullable(),
  /** At least one enterprise type is chosen at onboarding (FR-002); may grow later, additively. */
  enterpriseTypes: z.array(enterpriseTypeSchema),
  hectares: z.number().nonnegative().nullable(),
  timezone: z.string().min(1),
  ...auditTimestamps,
});
export type Farm = z.infer<typeof farmSchema>;

export const newFarmSchema = farmSchema
  .pick({ id: true, businessId: true, name: true, province: true })
  .extend({
    jurisdiction: farmSchema.shape.jurisdiction.default('ZA'),
    district: farmSchema.shape.district.default(null),
    enterpriseTypes: z.array(enterpriseTypeSchema).min(1),
    hectares: farmSchema.shape.hectares.default(null),
    timezone: farmSchema.shape.timezone.default('Africa/Johannesburg'),
  });
export type NewFarm = z.infer<typeof newFarmSchema>;

// ── User ────────────────────────────────────────────────────────────────────
// A person. Identity is business-wide; ROLE is per-farm and lives on FarmUser, never
// here (SRS-12). A user has an email OR a phone (or both), never neither.

export const userSchema = z
  .object({
    id: uuidSchema,
    email: z.string().email().nullable(),
    phone: z.string().min(1).nullable(),
    fullName: z.string().min(1),
    locale: localeSchema,
    theme: themeSchema,
    ...auditTimestamps,
  })
  .refine((u) => u.email !== null || u.phone !== null, {
    message: 'A user must have an email or a phone',
    path: ['email'],
  });
export type User = z.infer<typeof userSchema>;

export const newUserSchema = z
  .object({
    id: uuidSchema,
    email: z.string().email().nullable().default(null),
    phone: z.string().min(1).nullable().default(null),
    fullName: z.string().min(1),
    locale: localeSchema.default('en-ZA'),
    theme: themeSchema.default('light'),
  })
  .refine((u) => u.email !== null || u.phone !== null, {
    message: 'A user must have an email or a phone',
    path: ['email'],
  });
export type NewUser = z.infer<typeof newUserSchema>;

// ── FarmUser ──────────────────────────────────────────────────────────────────
// The membership row. Role is per FARM (SRS-12): the same person is a manager on one
// farm and a worker on another. `scope`/`expires_at` carry the 'external' grant (FR-005).

export const farmUserSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  userId: uuidSchema,
  role: userRoleSchema,
  /** For 'external' actors: the herds/modules they may see. Free-form until FR-011. */
  scope: z.record(z.string(), z.unknown()).nullable(),
  /** For 'external' actors: when the grant lapses. */
  expiresAt: timestampSchema.nullable(),
  ...auditTimestamps,
});
export type FarmUser = z.infer<typeof farmUserSchema>;

export const newFarmUserSchema = farmUserSchema
  .pick({ id: true, farmId: true, userId: true, role: true })
  .extend({
    scope: farmUserSchema.shape.scope.default(null),
    expiresAt: farmUserSchema.shape.expiresAt.default(null),
  });
export type NewFarmUser = z.infer<typeof newFarmUserSchema>;

// ── Enterprise ────────────────────────────────────────────────────────────────
// The financial attribution unit — "Beef cattle", "Maize 2026", "Chardonnay". A farm
// declares enterprise *types*; each concrete enterprise is a row here (ADR-0004).

export const enterpriseSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  name: z.string().min(1),
  type: enterpriseTypeSchema,
  active: z.boolean(),
  ...auditTimestamps,
});
export type Enterprise = z.infer<typeof enterpriseSchema>;

export const newEnterpriseSchema = enterpriseSchema
  .pick({ id: true, farmId: true, name: true, type: true })
  .extend({
    active: enterpriseSchema.shape.active.default(true),
  });
export type NewEnterprise = z.infer<typeof newEnterpriseSchema>;
