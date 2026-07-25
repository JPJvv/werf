/**
 * A GPS fix, as GeoJSON.
 *
 * Geolocation is one of the few browser capabilities that genuinely works with no signal: GPS is a
 * receiver, not a connection. That is what makes FR-605's "GPS-anchored" a promise the app can keep
 * standing at a cut fence in a dead zone — but only if the fix is asked for and waited on, rather
 * than assumed.
 *
 * It can still fail: permission refused, no receiver, or a phone that cannot see the sky. Those are
 * different from "offline" and must be said differently — a farmer told "you are offline" when the
 * real problem is a denied permission will keep walking somewhere with signal and get nowhere.
 */

/** Why a fix could not be taken. Each maps to different advice, so they are not collapsed into one. */
export type FixFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export type FixResult =
  | { readonly ok: true; readonly geojson: string }
  | { readonly ok: false; readonly reason: FixFailure };

/** How long to wait for a fix before giving up. A cold GPS fix under trees genuinely takes this long. */
const FIX_TIMEOUT_MS = 20_000;

export function currentPoint(): Promise<FixResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }

  return new Promise<FixResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // GeoJSON is [longitude, latitude] — the opposite order to how a phone reports it and to
        // how everyone says it out loud. Getting this backwards puts a Free State camp in Somalia.
        const geojson = JSON.stringify({
          type: 'Point',
          coordinates: [position.coords.longitude, position.coords.latitude],
        });
        resolve({ ok: true, geojson });
      },
      (error) => {
        const reason: FixFailure =
          error.code === error.PERMISSION_DENIED
            ? 'denied'
            : error.code === error.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        resolve({ ok: false, reason });
      },
      // No `maximumAge`: a last-seen point that is actually where the phone was an hour ago is
      // worse than no point, because it looks authoritative on a document handed to the police.
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}
