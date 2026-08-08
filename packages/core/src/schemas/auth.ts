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

/**
 * Update the signed-in account's own preferences (FR-008). The user is the AUTHENTICATED caller —
 * there is no id in the body, so this endpoint cannot be aimed at somebody else's account.
 *
 * Locale only, for now, and deliberately: language is a property of the PERSON (it follows them
 * onto a borrowed tablet), which is why it must reach the user row instead of living on a device.
 * Theme is a genuinely device-shaped preference — the same farmer wants dark on the phone they
 * use at 5am and light on the office desktop — so it is not here until there is a reason.
 */
export const updateProfileRequestSchema = z.object({
  locale: localeSchema,
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/**
 * One of the farm's herds/enterprises, as the client needs it (FR-113). The `enterpriseTypes` array
 * above drives the ADAPTIVE UI — which tiles a farm sees; this carries the enterprise ROWS, because
 * filing a capture under the herd it concerns needs the enterprise's id, and telling two cattle
 * herds apart needs its name. A farm may run two enterprises of the same type ("Bonsmara cows",
 * "Feedlot"), which is precisely why the type alone cannot do this job.
 */
export const sessionEnterpriseSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  type: enterpriseTypeSchema,
});
export type SessionEnterprise = z.infer<typeof sessionEnterpriseSchema>;

/** The farms a signed-in user may act on, and the role they hold on each (roles are per FARM). */
export const sessionFarmSchema = z.object({
  id: uuidSchema,
  /**
   * The business this farm belongs to (FR-004). DEFAULTED to null for the same reason
   * `enterprises` is defaulted: a session cached before this field existed is re-parsed on every
   * cold start, and making it mandatory would fail that parse and sign a farmer out — offline,
   * with captures queued, because of an app update. Null means "this device does not know yet",
   * and the client simply cannot offer to add a farm until the next sign-in fills it in.
   *
   * It is here because adding a SECOND farm needs it, and a client that had to ask the server for
   * it first would be a client that cannot start the flow offline.
   */
  businessId: uuidSchema.nullable().default(null),
  name: z.string().min(1),
  enterpriseTypes: z.array(enterpriseTypeSchema),
  /**
   * The farm's active herds/enterprises. DEFAULTED, not required: a session cached before this
   * field existed is re-parsed on every cold start, and making it mandatory would fail that parse
   * and sign a farmer out — offline, with captures queued, because of an app update. An empty list
   * means "this device does not know the herds yet", which the capture screens handle by asking for
   * a species instead; the next sign-in fills it in.
   */
  enterprises: z.array(sessionEnterpriseSchema).default([]),
  role: z.string().min(1),
});
export type SessionFarm = z.infer<typeof sessionFarmSchema>;

/**
 * The account's second-factor posture, carried on every session so the client knows
 * whether to route the user into enrolment before anything else (FR-014).
 *
 * `required` means the server will refuse everything but enrolment — an owner or a
 * bookkeeper who has not enrolled yet. `optional` is a manager who may. `complete` is
 * anyone enrolled. The client renders the difference; the server enforces it.
 */
export const secondFactorStatusSchema = z.enum(['complete', 'required', 'optional']);
export type SecondFactorStatus = z.infer<typeof secondFactorStatusSchema>;

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
  /**
   * Whether this account still owes a second-factor enrolment. Part of the cached session
   * because a cold start with no signal must know whether to render the app or the
   * enrolment screen without asking the server (FR-006).
   */
  secondFactor: secondFactorStatusSchema,
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

/**
 * Which second factor a caller is presenting. Explicit rather than inferred from the
 * shape of the string: a recovery code and a TOTP code are different secrets with
 * different consequences (one is consumed forever), and deciding which by counting
 * characters is the kind of guess that silently burns a farmer's recovery code because
 * they typed a space.
 *
 * `passkey` is absent here on purpose — WebAuthn is a challenge/response exchange, not a
 * typed code, and it gets its own endpoints.
 */
export const secondFactorMethodSchema = z.enum(['totp', 'recovery_code']);
export type SecondFactorMethod = z.infer<typeof secondFactorMethodSchema>;

/** Redeems the half-authenticated session from `secondFactorRequired` for a real one. */
export const verifySecondFactorRequestSchema = z.object({
  challengeToken: z.string().min(1),
  method: secondFactorMethodSchema,
  /** A 6-digit TOTP code or a recovery code. Whitespace is the user's; we strip it. */
  code: z.string().min(1).max(64),
});
export type VerifySecondFactorRequest = z.infer<typeof verifySecondFactorRequestSchema>;

/**
 * What starting TOTP enrolment hands back. The secret is here because it has to be — the
 * authenticator app needs it — and this is the ONLY response in the system that carries
 * one. It is never returned again: re-enrolling generates a fresh secret rather than
 * re-showing this one, so a stolen session cannot read back an existing seed.
 */
export const totpEnrolmentStartResponseSchema = z.object({
  /** Base32, for typing in by hand when the camera won't focus. */
  secret: z.string().min(1),
  /** `otpauth://…`, for the QR code. */
  uri: z.string().min(1),
});
export type TotpEnrolmentStartResponse = z.infer<typeof totpEnrolmentStartResponseSchema>;

export const totpEnrolmentConfirmRequestSchema = z.object({
  code: z.string().min(1).max(16),
});
export type TotpEnrolmentConfirmRequest = z.infer<typeof totpEnrolmentConfirmRequestSchema>;

/**
 * Enrolment succeeded, and here are the recovery codes — SHOWN ONCE (FR-014a).
 *
 * Once is not a UX flourish. We store argon2id hashes, so we genuinely cannot show them
 * again; the alternative is keeping them recoverable, which makes them a second copy of
 * the account rather than a break-glass measure. The copy that goes with this tells the
 * farmer to print it and put it in the safe.
 */
export const totpEnrolmentConfirmResponseSchema = z.object({
  /**
   * Ten codes on the FIRST factor this account enrols, and null on any later one — the
   * same contract the passkey path has always had. Null means "you already have recovery
   * codes and the page in your safe still works", which is a different message to the
   * farmer than a fresh set, and the client must render it as one. Returning a new set
   * here would silently retire the printed page (FR-014a).
   */
  recoveryCodes: z.array(z.string().min(1)).length(10).nullable(),
});
export type TotpEnrolmentConfirmResponse = z.infer<typeof totpEnrolmentConfirmResponseSchema>;

/**
 * ── Passkeys (WebAuthn) ──────────────────────────────────────────────────────────
 *
 * ADR-0007's PREFERRED second factor. The word "passkey" never reaches a farmer: on
 * their phone this is the fingerprint they already use forty times a day, and the copy
 * says so.
 *
 * The ceremony options we send are produced by the WebAuthn library and handed straight
 * to `navigator.credentials`, so they are typed loosely here — validating a blob we
 * generated ourselves, against a spec that gains fields, buys nothing and breaks on the
 * next browser. What the CLIENT sends back is validated strictly, because that is the
 * untrusted direction.
 */
export const passkeyCeremonyOptionsSchema = z.object({
  /** `PublicKeyCredentialCreationOptionsJSON` or `…RequestOptionsJSON`, server-generated. */
  options: z.record(z.unknown()),
});
export type PasskeyCeremonyOptions = z.infer<typeof passkeyCeremonyOptionsSchema>;

/** Fields common to both ceremonies' responses, as `@simplewebauthn/browser` returns them. */
const credentialEnvelope = {
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.unknown()).default({}),
  authenticatorAttachment: z.string().nullish(),
};

/** What the browser returns after creating a credential. Verified server-side. */
export const passkeyRegistrationResponseSchema = z.object({
  ...credentialEnvelope,
  response: z.object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
    authenticatorData: z.string().optional(),
  }),
});

export const passkeyRegistrationRequestSchema = z.object({
  credential: passkeyRegistrationResponseSchema,
  /** "Samsung A15" — so a person can recognise and revoke one key among several. */
  deviceLabel: z.string().min(1).max(64).nullable().default(null),
});
export type PasskeyRegistrationRequest = z.infer<typeof passkeyRegistrationRequestSchema>;

/** What the browser returns after signing a challenge. Verified server-side. */
export const passkeyAuthenticationResponseSchema = z.object({
  ...credentialEnvelope,
  response: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().nullish(),
  }),
});

/** Satisfies the second factor with a passkey, completing a half-authenticated login. */
export const passkeyAuthenticationRequestSchema = z.object({
  challengeToken: z.string().min(1),
  credential: passkeyAuthenticationResponseSchema,
});
export type PasskeyAuthenticationRequest = z.infer<typeof passkeyAuthenticationRequestSchema>;

/** Begins an authentication ceremony for a login that has passed the password. */
export const passkeyChallengeRequestSchema = z.object({
  challengeToken: z.string().min(1),
});
export type PasskeyChallengeRequest = z.infer<typeof passkeyChallengeRequestSchema>;

/**
 * A passkey the user has enrolled, for the "which devices can open this account?" list.
 * Public keys are NEVER in here — nothing about this table is secret, which is the point
 * of choosing public-key credentials, but there is also no reason to ship the key.
 */
export const passkeySummarySchema = z.object({
  id: uuidSchema,
  deviceLabel: z.string().nullable(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});
export type PasskeySummary = z.infer<typeof passkeySummarySchema>;

/**
 * What completing passkey enrolment returns.
 *
 * `recoveryCodes` is present only when this enrolment was the account's FIRST second
 * factor, and then exactly once (FR-014a). A passkey-only owner whose phone drowns has
 * no other way back in, so the codes have to be minted here rather than only alongside
 * TOTP — and null means "you already have a printed page", not "you have none".
 */
export const passkeyEnrolmentResponseSchema = z.object({
  passkey: passkeySummarySchema,
  recoveryCodes: z.array(z.string().min(1)).length(10).nullable(),
});
export type PasskeyEnrolmentResponse = z.infer<typeof passkeyEnrolmentResponseSchema>;
