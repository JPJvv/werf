/**
 * Identity & tenancy core (Phase 1): businesses, farms, users, user_passkeys,
 * farm_users, enterprises. Implements docs/03-architecture/database-schema.md § 2.
 *
 * Geometry (farm centroid/boundary + their geojson mirrors) is deliberately NOT here
 * yet: Phase 1 has no spatial feature, and additive-only migrations let the mapping
 * feature add those columns without a rewrite. See the schema doc for the full shape.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, bytea, citext, primaryId } from './columns';
import { enterpriseTypeEnum, userRoleEnum } from './enums';

/** The account root. One business owns many farms (FR-001, FR-004). */
export const businesses = pgTable('businesses', {
  id: primaryId(),
  name: text('name').notNull(),
  registrationNumber: text('registration_number'),
  vatNumber: text('vat_number'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  physicalAddressLine1: text('physical_address_line_1'),
  physicalAddressLine2: text('physical_address_line_2'),
  physicalAddressLocality: text('physical_address_locality'),
  physicalAddressProvince: text('physical_address_province'),
  physicalAddressPostalCode: text('physical_address_postal_code'),
  ...auditColumns,
});

/**
 * The unit of tenancy AND of jurisdiction. `enterprise_types` drives the whole UI.
 * `jurisdiction` is the law this farm operates under — from the FARM, never the user
 * or browser — locked to 'ZA' in v1 by a CHECK so a second country is a migration and
 * a conversation, not a config flag (FR-018, ADR-0006).
 */
export const farms = pgTable(
  'farms',
  {
    id: primaryId(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    name: text('name').notNull(),
    jurisdiction: char('jurisdiction', { length: 2 }).notNull().default('ZA'),
    province: text('province').notNull(),
    district: text('district'),
    enterpriseTypes: enterpriseTypeEnum('enterprise_types')
      .array()
      .notNull()
      .default(sql`'{}'`),
    hectares: numeric('hectares', { precision: 10, scale: 2 }),
    timezone: text('timezone').notNull().default('Africa/Johannesburg'),
    /** Number of UTC calendar-month event buckets retained on each device (offline-sync.md §3). */
    eventRetentionMonths: integer('event_retention_months').notNull().default(24),
    ...auditColumns,
  },
  (t) => [
    check('farms_jurisdiction_v1', sql`${t.jurisdiction} = 'ZA'`),
    check('farms_event_retention_months_positive', sql`${t.eventRetentionMonths} > 0`),
  ],
);

/**
 * A person. Identity is business-wide; ROLE is per-farm on farm_users, never here.
 * `email` is citext so casing never splits an account. The TOTP seed is encrypted with
 * the PII key (not the DB key) and, with recovery codes, NEVER syncs to a device.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: citext('email').unique(),
    phone: text('phone').unique(),
    passwordHash: text('password_hash'), // argon2id
    fullName: text('full_name').notNull(),
    locale: text('locale').notNull().default('en-ZA'), // per USER, not per farm (SRS-19)
    theme: text('theme').notNull().default('light'), // 'light'|'dark'|'system' (FR-016)
    totpSecretEncrypted: bytea('totp_secret_encrypted'),
    totpEnrolledAt: timestamp('totp_enrolled_at', { withTimezone: true }),

    /**
     * The last TOTP counter step accepted for this user. A TOTP code stays valid for its
     * whole 30-second period (longer, with the drift window), so without this the same
     * six digits — read over a shoulder or off a shared screen — can be spent twice.
     * Refusing any step at or below this one makes a code single-use, like the recovery
     * codes beside it.
     */
    totpLastUsedStep: bigint('totp_last_used_step', { mode: 'number' }),

    recoveryCodesHashed: text('recovery_codes_hashed').array(), // argon2id, single-use, 10 issued
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [check('users_contact', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`)],
);

/**
 * Passkeys (WebAuthn). Public keys only — a breach of this table gives an attacker
 * nothing, which is the point. No `updated_at`: a passkey is created, used, revoked.
 */
export const userPasskeys = pgTable('user_passkeys', {
  id: primaryId(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  credentialId: bytea('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
  transports: text('transports').array(),
  deviceLabel: text('device_label'), // "Samsung A15" — so a user can revoke one
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** Membership. Role is per FARM (SRS-12); `scope`/`expires_at` carry the 'external' grant. */
export const farmUsers = pgTable(
  'farm_users',
  {
    id: primaryId(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: userRoleEnum('role').notNull(),
    scope: jsonb('scope'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    /**
     * Invitation lifecycle. A membership is only REAL once `accepted_at` is set —
     * `app_user_farm_ids()` ignores pending rows, so an invitation grants nothing until
     * the invitee agrees.
     *
     * Without this, inviting is a one-sided act with cross-tenant consequences: naming any
     * email address would make that person a co-member, and the `users` RLS policy would
     * then disclose their real name, phone and locale to the inviter — data belonging to
     * someone who never agreed to share it. POPIA makes that our problem, and a farm owner
     * choosing whose PII to acquire is not a defensible design.
     *
     * Self-created memberships (registering, or adding your own farm) are accepted on the
     * spot: consent is not in question when you are inviting yourself.
     */
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [unique('farm_users_farm_user_unique').on(t.farmId, t.userId)],
);

/** The financial attribution unit — "Beef cattle", "Maize 2026", "Chardonnay" (ADR-0004). */
export const enterprises = pgTable('enterprises', {
  id: primaryId(),
  farmId: uuid('farm_id')
    .notNull()
    .references(() => farms.id),
  name: text('name').notNull(),
  type: enterpriseTypeEnum('type').notNull(),
  active: boolean('active').notNull().default(true),
  ...auditColumns,
});

/**
 * The regulated-rate registry — the mechanism that makes "never hardcode a regulated
 * number" enforceable (FR-019, ADR-0005). Every minimum wage, threshold, cap, multiplier,
 * and withdrawal period is a row here with an effective-date range and a gazette reference,
 * looked up by the date an event OCCURRED. NOT farm-scoped: it is reference data keyed by
 * `jurisdiction` (from the FARM), so there is NO farm_id and — unlike farms — NO ZA-lock
 * CHECK, because a second country's rates live in the very same table. `value` is
 * numeric(14,4): a rate, a factor, or a fraction, never money-cents and never a float.
 */
export const regulatoryRates = pgTable(
  'regulatory_rates',
  {
    id: primaryId(),
    jurisdiction: char('jurisdiction', { length: 2 }).notNull().default('ZA'),
    code: text('code').notNull(), // 'NMW_FARM','BCEA_THRESHOLD','UIF_CEILING',... — ZA names live in @werf/domain/za
    value: numeric('value', { precision: 14, scale: 4 }).notNull(),
    unit: text('unit').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'), // NULL = in force
    gazetteReference: text('gazette_reference').notNull(), // every rate traces to a source
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('regulatory_rates_unique').on(t.jurisdiction, t.code, t.effectiveFrom),
    index('regulatory_rates_lookup').on(t.jurisdiction, t.code, t.effectiveFrom.desc()),
  ],
);
