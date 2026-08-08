/**
 * The passkey ceremonies (FR-014/014c, ADR-0007) — the one place in the client that touches the
 * WebAuthn API, so every screen above it deals in plain results rather than in `DOMException`s.
 *
 * ⭐ Why a passkey is the PREFERRED second factor here and SMS is not a factor at all: a passkey is
 * held by the device and works with no signal, which on this product is the normal state rather
 * than the failure state. It cannot be SIM-swapped, and SIM swap is industrialised in South Africa.
 * And there is nothing to type — a farmer in a crush, in gloves, in the sun, is not going to read a
 * six-digit code off a second phone. TOTP stays as the universal fallback for the devices and
 * browsers that cannot do this; it is a fallback, not the default.
 *
 * ⭐ Every failure is TRANSLATED to a small closed set, and never surfaced as the browser's own
 * message. A `DOMException` from an authenticator says things like "The operation either timed out
 * or was not allowed" — which is both alarming and useless, and is the same string whether the
 * person tapped cancel, took too long, or is on a device with no authenticator at all. Those need
 * different actions, so they are different results.
 */

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { schemas } from '@werf/core';

/** Why a ceremony did not complete, in terms a screen can act on. */
export type PasskeyFailure =
  /** The device or browser has no authenticator we can use. Offer TOTP instead. */
  | 'unsupported'
  /** The person cancelled, or the prompt timed out. Not an error; offer it again. */
  | 'cancelled'
  /** This device already holds a key for this account. Nothing to do, and nothing broken. */
  | 'alreadyEnrolled'
  /** Anything else the authenticator refused. */
  | 'failed';

export type PasskeyResult<T> = { ok: true; credential: T } | { ok: false; reason: PasskeyFailure };

/**
 * Can this device do a passkey at all?
 *
 * Asked BEFORE the button is shown rather than after it is pressed. Offering a factor the device
 * cannot produce, and only saying so once someone has committed to it, is how a mandatory 2FA
 * screen becomes a dead end for a user who has no other route into their own account.
 */
export function passkeysAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    navigator.credentials !== undefined
  );
}

/** Create a credential from the server's options (enrolment). */
export async function createPasskey(
  options: schemas.PasskeyCeremonyOptions,
): Promise<PasskeyResult<schemas.PasskeyRegistrationRequest['credential']>> {
  if (!passkeysAvailable()) return { ok: false, reason: 'unsupported' };
  try {
    const credential = await startRegistration({
      // The server generates these and the schema types them as an opaque record on purpose —
      // they are @simplewebauthn's shape, produced by @simplewebauthn/server, and re-declaring
      // them here would be a second copy to keep in step. The cast is the boundary where that
      // opacity ends; nothing downstream of it is untyped.
      optionsJSON: options.options as unknown as Parameters<
        typeof startRegistration
      >[0]['optionsJSON'],
    });
    return { ok: true, credential: credential as schemas.PasskeyRegistrationRequest['credential'] };
  } catch (caught) {
    return { ok: false, reason: classify(caught, true) };
  }
}

/** Sign the server's challenge with an existing credential (login). */
export async function usePasskey(
  options: schemas.PasskeyCeremonyOptions,
): Promise<PasskeyResult<schemas.PasskeyAuthenticationRequest['credential']>> {
  if (!passkeysAvailable()) return { ok: false, reason: 'unsupported' };
  try {
    const credential = await startAuthentication({
      optionsJSON: options.options as unknown as Parameters<
        typeof startAuthentication
      >[0]['optionsJSON'],
    });
    return {
      ok: true,
      credential: credential as schemas.PasskeyAuthenticationRequest['credential'],
    };
  } catch (caught) {
    return { ok: false, reason: classify(caught, false) };
  }
}

/**
 * Turn whatever the authenticator threw into one of the four outcomes a screen can act on.
 *
 * `NotAllowedError` is the interesting one and it is deliberately treated as CANCELLED rather than
 * as a failure: the spec uses it both for "the user dismissed the prompt" and for "the ceremony
 * timed out", and it withholds which on purpose so a site cannot probe what a person did. Calling
 * that an error would put a red panel in front of someone whose only mistake was tapping the wrong
 * thing — so it reads as "not finished", and the button is still there.
 *
 * `InvalidStateError` on a REGISTRATION means this authenticator already holds a credential the
 * server excluded — that is, the device is already enrolled. That is not a failure either; it is
 * the answer. On an authentication it means something genuinely went wrong, which is why the
 * ceremony is passed in rather than assumed.
 */
function classify(caught: unknown, registering: boolean): PasskeyFailure {
  const name = caught instanceof Error ? caught.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (name === 'InvalidStateError' && registering) return 'alreadyEnrolled';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  return 'failed';
}

/** A default label for a new key, so the list is readable without asking anyone to name it. */
export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  for (const [pattern, label] of GUESSES) {
    if (pattern.test(ua)) return label;
  }
  return 'This device';
}

/**
 * A coarse guess, and coarse on purpose. The label exists so a person can tell one key from
 * another well enough to revoke the right one — "the iPhone, not the office machine" — and it is
 * editable. Reaching for a fingerprinting library to get "Samsung Galaxy A15" would collect far
 * more than that question needs, on a product with POPIA in its bones.
 */
const GUESSES: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/i, 'iPhone'],
  [/iPad/i, 'iPad'],
  [/Android/i, 'Android phone'],
  [/Macintosh|Mac OS/i, 'Mac'],
  [/Windows/i, 'Windows PC'],
  [/Linux/i, 'Linux PC'],
];
