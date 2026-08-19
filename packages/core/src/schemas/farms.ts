/**
 * Wire contract for farm management: creating farms under a business, changing which
 * enterprises a farm runs, inviting people, and switching the active farm (FR-003, FR-004,
 * FR-005).
 */

import { z } from 'zod';
import { enterpriseTypeSchema, userRoleSchema, uuidSchema } from './primitives';

/**
 * A second (or fifth) farm under a business the caller already owns (FR-004).
 * `jurisdiction` is absent by design — it comes from the farm and is fixed at 'ZA' in v1,
 * never chosen by a caller.
 */
export const createFarmRequestSchema = z.object({
  businessId: uuidSchema,
  name: z.string().min(1),
  province: z.string().min(1),
  district: z.string().min(1).nullable().default(null),
  enterpriseTypes: z.array(enterpriseTypeSchema).min(1),
});
export type CreateFarmRequest = z.infer<typeof createFarmRequestSchema>;

/**
 * Change what a farm runs (FR-002, FR-003). Both directions are non-destructive: adding
 * needs no migration, and removing a type retires its enterprises rather than deleting
 * them, so last season's maize costs still exist after the farmer stops growing maize.
 */
export const updateEnterpriseTypesRequestSchema = z
  .object({
    add: z.array(enterpriseTypeSchema).default([]),
    remove: z.array(enterpriseTypeSchema).default([]),
  })
  .refine((v) => v.add.length > 0 || v.remove.length > 0, {
    message: 'Nothing to change',
  });
export type UpdateEnterpriseTypesRequest = z.infer<typeof updateEnterpriseTypesRequestSchema>;

/**
 * Set or clear the farm's FR-152 rest-period WARNING threshold (4e·2) — an agronomic
 * preference the owner sets, never a literal in code (ADR-0006's boundary: this is veld
 * management, not law, so it carries no jurisdiction and no `effective_from`). `null` clears
 * it back to "no warning shown", which is a real, intentional choice, not an omission — so it
 * is a required field rather than an optional one a caller could forget.
 */
export const updateRestPeriodDaysRequestSchema = z.object({
  restPeriodDays: z.number().int().positive().nullable(),
});
export type UpdateRestPeriodDaysRequest = z.infer<typeof updateRestPeriodDaysRequestSchema>;

/**
 * Invite someone to a farm with a role (FR-005). The role is attached to THIS farm only —
 * the same person can be a manager here and a viewer next door (SRS-12).
 */
export const inviteUserRequestSchema = z
  .object({
    fullName: z.string().min(1),
    email: z.string().email().nullable().default(null),
    phone: z.string().min(1).nullable().default(null),
    role: userRoleSchema,
  })
  .refine((v) => v.email !== null || v.phone !== null, {
    message: 'An invitation needs an email or a phone number',
    path: ['email'],
  });
export type InviteUserRequest = z.infer<typeof inviteUserRequestSchema>;

/** Switch which farm the current session is acting on — without re-authenticating (FR-004). */
export const switchFarmRequestSchema = z.object({
  farmId: uuidSchema,
});
export type SwitchFarmRequest = z.infer<typeof switchFarmRequestSchema>;
