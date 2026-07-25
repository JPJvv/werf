/**
 * Server configuration, validated at boot. An API that starts with a missing JWT secret
 * and fails on the first login is worse than one that refuses to start, so every value is
 * parsed here and the process dies loudly if the environment is wrong.
 */

import { z } from 'zod';
import { keysAreIdentical, parsePiiKey } from '../auth/pii-crypto';

/**
 * Token lifetimes from ADR-0007. These are NOT regulated numbers — the "never hardcode a
 * regulated number" rule is about minimum wage, UIF ceilings and BCEA thresholds, which
 * change by gazette and must be looked up by the date an event occurred. A session
 * lifetime is a security parameter of ours; it belongs in code, next to the ADR that
 * chose it.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * 30 days. This is the offline window: a farmer who spends three weeks in a signal dead
 * zone must come back to their own data, not to a login wall.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long a half-authenticated login stays open — the window between "the password was
 * right" and "the second factor was satisfied". Five minutes: long enough to find your
 * phone, open the authenticator and type six digits with gloves on; short enough that a
 * challenge token left in a log or a proxy cache is worthless by the time anyone reads it.
 *
 * Explicitly NOT the 30-day refresh window. A challenge token IS a refresh token in
 * storage terms, so inheriting that lifetime would leave a password-only artefact valid
 * for a month (ADR-0007).
 */
export const SECOND_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * The outbound mail relay (FR-005). Entirely optional: with no host configured the API boots with
 * the logging adapter, which is what development and tests use. That is a deliberate default —
 * requiring a mail server to work on livestock capture would be a tax on every developer, and an
 * API that silently sent nothing would make a missing invitation impossible to diagnose.
 *
 * SMTP rather than a provider SDK, so the provider is a deployment decision. ADR-0002 already
 * pins this deployment to af-south-1 over data residency; binding the code to one mail vendor
 * would repeat that mistake a layer up.
 */
const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(587),
  // 587 with STARTTLS is the common case; `true` is implicit TLS on 465.
  secure: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  user: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  /** The envelope sender. Must be an address the relay is allowed to send as. */
  from: z.string().min(1),
});

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),

  /**
   * The RLS-bound connection — must name `werf_app`, NOT the owner. If this points at a
   * superuser, every RLS policy in the database silently stops applying, which is the
   * kind of failure that looks like everything working.
   */
  databaseUrl: z.string().url(),

  /** The RLS-bypassing connection, for provisioning and the refresh path only. */
  databaseElevatedUrl: z.string().url(),

  /**
   * Access-token signing key. 32 bytes minimum; the floor is enforced rather than
   * documented because a short HMAC secret is brute-forceable offline and nothing about
   * the system looks broken while it happens.
   */
  jwtSecret: z.string().min(32),

  /**
   * The PII key: base64, exactly 32 bytes, used to encrypt TOTP seeds today and
   * employees' ID and banking details from Phase 5. It is a SEPARATE key from anything
   * the database holds, because its only job is to make a stolen database dump useless
   * (ADR-0007, .claude/rules/db.md). Generate with:
   *
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  piiEncryptionKey: z
    .string()
    // Shape first: `Buffer.from` silently DISCARDS characters outside the base64
    // alphabet, so a typo'd key decodes to the right length from the wrong material and
    // boots happily. Checking the text before the length means a mangled key is caught
    // here rather than becoming an undecryptable column six months from now.
    .regex(/^[A-Za-z0-9+/]{43}=$|^[A-Za-z0-9+/]{44}$/, 'must be base64')
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 base64 bytes'),

  /**
   * The WebAuthn Relying Party ID: the registrable domain a passkey is bound to, e.g.
   * `werf.co.za`. A credential created under one RP ID cannot be used under another —
   * that binding IS the phishing resistance, and it is enforced by the authenticator on
   * the user's own phone, not by us. Getting it wrong does not weaken security; it makes
   * every existing passkey stop working, so it must never change casually.
   *
   * Defaults to `localhost`, which is the one host browsers permit WebAuthn on without
   * TLS.
   */
  webauthnRpId: z.string().min(1).default('localhost'),

  /** What the phone shows the farmer in its own prompt. Never the word "passkey". */
  webauthnRpName: z.string().min(1).default('Werf'),

  /**
   * The exact origin(s) the ceremony must have happened on — scheme, host and port.
   * Distinct from the RP ID and checked separately: the RP ID pins the domain, the origin
   * pins the actual page, so `https://werf.co.za` and `http://werf.co.za` are not
   * interchangeable.
   */
  webauthnOrigin: z
    .string()
    .min(1)
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim())),

  /** Null when no relay is configured — see `smtpSchema`. */
  smtp: smtpSchema.nullable(),
});

export type AppConfig = z.infer<typeof configSchema>;

/** Reads and validates configuration. Throws — at boot, where a human is watching. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    databaseElevatedUrl: env.DATABASE_ELEVATED_URL ?? env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    piiEncryptionKey: env.PII_ENCRYPTION_KEY,
    webauthnRpId: env.WEBAUTHN_RP_ID,
    webauthnRpName: env.WEBAUTHN_RP_NAME,
    webauthnOrigin: env.WEBAUTHN_ORIGIN,
    // All-or-nothing: a half-configured relay (a host with no from-address) is a misconfiguration
    // worth failing on, not something to paper over by falling back to the log.
    smtp:
      env.SMTP_HOST === undefined
        ? null
        : {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            user: env.SMTP_USER,
            password: env.SMTP_PASSWORD,
            from: env.SMTP_FROM,
          },
  });

  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server configuration:\n${problems.join('\n')}`);
  }

  // Two keys that are the same material are one key wearing two names: a single
  // compromise then yields both session forgery and every TOTP seed. Nothing about the
  // running system would look wrong, so it has to be caught here or not at all.
  //
  // Compared as BYTES, not as strings. The PII key is base64 and the JWT secret is raw
  // text, so `piiKey === jwtSecret` only catches a literal copy-paste and sails past the
  // likelier mistake — someone base64-encoding the JWT secret to satisfy the validator
  // above and reusing it, which is the same key with extra steps.
  if (
    keysAreIdentical(parsePiiKey(parsed.data.piiEncryptionKey), Buffer.from(parsed.data.jwtSecret))
  ) {
    throw new Error(
      'Invalid server configuration:\n  PII_ENCRYPTION_KEY must not be the same material ' +
        'as JWT_SECRET — separate keys are the whole point of encrypting PII at rest',
    );
  }

  return parsed.data;
}
