/**
 * Jurisdiction is the country whose law governs a farm. v1 is locked to ZA, but every
 * regulated row carries a jurisdiction so the second country is a directory and a
 * registry entry, not a rewrite. See ADR-0006. Jurisdiction comes from THE FARM —
 * never the user, the browser locale, or a default.
 */

export const SUPPORTED_JURISDICTIONS = ['ZA'] as const;

export type Jurisdiction = (typeof SUPPORTED_JURISDICTIONS)[number];

export function isJurisdiction(value: string): value is Jurisdiction {
  return (SUPPORTED_JURISDICTIONS as readonly string[]).includes(value);
}
