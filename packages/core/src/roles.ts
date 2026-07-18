/**
 * User roles. Role is assigned per FARM, not per user (SRS-12): the same person can
 * be a manager on one farm and a worker on another, so a role never lives on the
 * user row — it lives on farm_users. Values match the Postgres user_role enum.
 *
 * 2FA obligation by role is defined in ADR-0007, not here (that is auth policy, not
 * an identity primitive): mandatory for owner + bookkeeper, optional for manager.
 */

export const USER_ROLES = [
  'owner',
  'manager',
  'worker',
  'bookkeeper',
  'viewer',
  'external',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
