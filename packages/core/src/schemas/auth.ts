/**
 * The auth wire contract (FR-001, ADR-0007). Client and server validate with these exact
 * objects, so a field the client sends and the server ignores is a build error rather than
 * a mystery.
 *
 * Nothing secret is ever a RESPONSE field. Tokens are the one exception and they are the
 * point of the exchange; hashes, seeds, and recovery codes never appear in a schema here.
 */

import { z } from 'zod';
import { enterpriseTypeSchema, uuidSchema } from './primitives';
import { localeSchema, themeSchema, userSchema } from './entities';

/**
 * Passwords. A length floor and nothing else: composition rules ("one uppercase, one
 * symbol") measurably push people towards `Password1!` and towards writing it down.
 * Length is the property that actually costs an attacker something.
 *
 * The ceiling is not a policy — argon2id and most KDFs have input limits, and an unbounded
 * password field is a cheap denial-of-service (hash a 10MB "password", repeatedly).
 */
export const passwordSchema = z.string().min(12).max(256);

/**
 * Registering a business is the one call that creates a whole tenant at once: the account
 * root, its first farm, that farm's enterprises, and the owner (FR-001, FR-002).
 *
 * It is a single call because it is a single decision by the farmer, and because every
 * intermediate state is invalid — a business with no farm has no jurisdiction, and a farm
 * with no owner is a farm nobody can log into.
 */
export const registerRequestSchema = z.object({
  business: z.object({
    name: z.string().min(1),
    registrationNumber: z.string().min(1).nullable().default(null),
  }),
  farm: z.object({
    name: z.string().min(1),
    province: z.string().min(1),
    district: z.string().min(1).nullable().default(null),
    /** At least one, chosen at onboarding; more may be added later, additively (FR-002/003). */
    enterpriseTypes: z.array(enterpriseTypeSchema).min(1),
  }),
  owner: z.object({
    fullName: z.string().min(1),
    email: z.string().email(),
    password: passwordSchema,
    locale: localeSchema.default('en-ZA'),
    theme: themeSchema.default('light'),
  }),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  /** "Samsung A15" — shown later so a person can end a session they don't recognise. */
  deviceLabel: z.string().min(1).nullable().default(null),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/** The farms a signed-in user may act on, and the role they hold on each (roles are per FARM). */
export const sessionFarmSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  enterpriseTypes: z.array(enterpriseTypeSchema),
  role: z.string().min(1),
});
export type SessionFarm = z.infer<typeof sessionFarmSchema>;

/**
 * What a successful authentication returns. The client caches this to render the shell
 * offline for the 30-day window (FR-006), which is why it carries the farm list and the
 * user's locale/theme: a cold start with no signal must not have to ask the server who
 * this is or what language to speak.
 */
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  /** Seconds until the access token expires — 15 min (ADR-0007). */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string().min(1),
  refreshExpiresAt: z.string().datetime({ offset: true }),
  user: userSchema,
  farms: z.array(sessionFarmSchema),
  activeFarmId: uuidSchema.nullable(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

/**
 * Login succeeded on the first factor but the account has a second factor enrolled.
 * Deliberately carries NO tokens and NO farm data: until the second factor is satisfied
 * this is not a session, and a response shape that cannot hold a token cannot leak one
 * through a branch someone gets wrong later.
 */
export const secondFactorRequiredSchema = z.object({
  secondFactorRequired: z.literal(true),
  /** Short-lived handle identifying the half-authenticated session. */
  challengeToken: z.string().min(1),
  /** Which factors this user can satisfy. Never includes SMS — see ADR-0007. */
  methods: z.array(z.enum(['passkey', 'totp', 'recovery_code'])).min(1),
});
export type SecondFactorRequired = z.infer<typeof secondFactorRequiredSchema>;

export const loginResponseSchema = z.union([authSessionSchema, secondFactorRequiredSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;
