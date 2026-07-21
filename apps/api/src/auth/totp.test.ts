/**
 * TOTP against the RFCs' own published test vectors.
 *
 * This is the case CLAUDE.md means by "table-driven where the rules are table-driven": the
 * correctness of a second factor is not a matter of our opinion, it is a matter of whether
 * the codes we compute are the ones Google Authenticator computes. The vectors below are
 * copied from RFC 4226 Appendix D and RFC 6238 Appendix B, and they are the whole point —
 * a bug here locks every farmer out of their own account with a code that looks right.
 */

import { describe, expect, it } from 'vitest';
import {
  TOTP_PERIOD_SECONDS,
  base32Decode,
  base32Encode,
  deriveHotp,
  deriveTotp,
  generateTotpSecret,
  totpEnrolmentUri,
  verifyTotp,
} from './totp';

/** The RFCs' shared test seed: the ASCII string "12345678901234567890", base32-encoded. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('round-trips the RFC test seed', () => {
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
    expect(base32Encode(Buffer.from('12345678901234567890', 'ascii'))).toBe(RFC_SECRET);
  });

  it('accepts a secret retyped off paper — spaces, padding, lower case', () => {
    const messy = 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq====';
    expect(base32Decode(messy)).toEqual(base32Decode(RFC_SECRET));
  });
});

describe('HOTP (RFC 4226 Appendix D)', () => {
  // counter → the 6-digit code the RFC says it must produce.
  const VECTORS: ReadonlyArray<readonly [number, string]> = [
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ];

  it.each(VECTORS)('counter %i yields %s', (counter, expected) => {
    expect(deriveHotp(RFC_SECRET, counter)).toBe(expected);
  });
});

describe('TOTP (RFC 6238 Appendix B)', () => {
  /**
   * The RFC prints 8-digit codes; we issue 6. Truncating from the left is not a fudge —
   * both are `binary % 10^digits` of the same dynamic truncation, so the low six digits of
   * the RFC's eight are exactly the six we must produce.
   */
  const VECTORS: ReadonlyArray<readonly [number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  it.each(VECTORS)('unix time %i yields %s', (seconds, expected) => {
    expect(deriveTotp(RFC_SECRET, new Date(seconds * 1000))).toBe(expected);
  });
});

describe('verifying a code a person typed', () => {
  const NOW = new Date('2026-07-19T09:15:00.000Z');
  const step = (n: number) => new Date(NOW.getTime() + n * TOTP_PERIOD_SECONDS * 1000);

  it('accepts the current code', () => {
    expect(verifyTotp(RFC_SECRET, deriveTotp(RFC_SECRET, NOW), NOW).valid).toBe(true);
  });

  it('accepts a code that expired seconds ago, and one from a clock running fast', () => {
    // A farmer in gloves does not type six digits in the second before the code turns
    // over, and a cheap phone's clock drifts. Both must still get in.
    expect(verifyTotp(RFC_SECRET, deriveTotp(RFC_SECRET, step(-1)), NOW).valid).toBe(true);
    expect(verifyTotp(RFC_SECRET, deriveTotp(RFC_SECRET, step(1)), NOW).valid).toBe(true);
  });

  it('refuses a code from outside the drift window', () => {
    expect(verifyTotp(RFC_SECRET, deriveTotp(RFC_SECRET, step(-2)), NOW).valid).toBe(false);
    expect(verifyTotp(RFC_SECRET, deriveTotp(RFC_SECRET, step(2)), NOW).valid).toBe(false);
  });

  it('refuses another account‘s code', () => {
    const other = generateTotpSecret();
    expect(verifyTotp(RFC_SECRET, deriveTotp(other, NOW), NOW).valid).toBe(false);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 34 56', '   ', '000000'])(
    'refuses malformed input %j without throwing',
    (input) => {
      expect(() => verifyTotp(RFC_SECRET, input, NOW)).not.toThrow();
      // '000000' is well-formed but wrong for this seed at this instant; the rest are junk.
      expect(verifyTotp(RFC_SECRET, input, NOW).valid).toBe(false);
    },
  );

  it('reports WHICH step matched, so a used code can be refused a second time', () => {
    const currentStep = Math.floor(NOW.getTime() / 1000 / TOTP_PERIOD_SECONDS);
    expect(verifyTotp(RFC_SECRET, deriveTotp(RFC_SECRET, NOW), NOW).step).toBe(currentStep);
    expect(verifyTotp(RFC_SECRET, deriveTotp(RFC_SECRET, step(-1)), NOW).step).toBe(
      currentStep - 1,
    );
  });
});

describe('enrolment', () => {
  it('generates a fresh 160-bit secret each time', () => {
    const secrets = new Set(Array.from({ length: 50 }, generateTotpSecret));
    expect(secrets.size).toBe(50);
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('builds a URI an authenticator app can read', () => {
    const uri = totpEnrolmentUri({
      secret: RFC_SECRET,
      account: 'thabo@rietfontein.test',
      issuer: 'Werf',
    });

    expect(uri).toMatch(/^otpauth:\/\/totp\/Werf%3Athabo%40rietfontein\.test\?/);
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe(RFC_SECRET);
    expect(params.get('issuer')).toBe('Werf');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});
