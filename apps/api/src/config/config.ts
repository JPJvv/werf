/**
 * Server configuration, validated at boot. An API that starts with a missing JWT secret
 * and fails on the first login is worse than one that refuses to start, so every value is
 * parsed here and the process dies loudly if the environment is wrong.
 */

import { z } from 'zod';

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
});

export type AppConfig = z.infer<typeof configSchema>;

/** Reads and validates configuration. Throws — at boot, where a human is watching. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    databaseElevatedUrl: env.DATABASE_ELEVATED_URL ?? env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server configuration:\n${problems.join('\n')}`);
  }

  return parsed.data;
}
