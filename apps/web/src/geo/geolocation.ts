/**
 * A GPS fix.
 *
 * Farm-level rather than livestock-level, which it was until a camp boundary needed it. Three
 * unrelated captures ask this module the same question now — where a theft happened (FR-605), where
 * an animal was lost, and where the corners of a camp are (FR-150) — and a land screen reaching into
 * `livestock/` for its GPS would be the wrong-home mistake this repo keeps finding in other forms.
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

/**
 * Why the browser refused, in the three flavours that need different advice. One implementation,
 * because two copies of this mapping drift and the farmer reads the drift as a wrong instruction.
 */
function failureOf(error: GeolocationPositionError): FixFailure {
  if (error.code === error.PERMISSION_DENIED) return 'denied';
  if (error.code === error.TIMEOUT) return 'timeout';
  return 'unavailable';
}

/** A fix as coordinates rather than as GeoJSON text, with how well the phone knew where it was. */
export type CoordinateFixResult =
  | { readonly ok: true; readonly lon: number; readonly lat: number; readonly accuracyM: number }
  | { readonly ok: false; readonly reason: FixFailure };

/**
 * A fix as raw coordinates — for a capture that BUILDS a shape out of several fixes rather than
 * recording one place.
 *
 * ⭐ It carries `accuracy` and `currentPoint` does not, and that difference is deliberate. A single
 * anchor point is either taken or it is not; a boundary is an argument made out of a dozen fixes,
 * and how far out the worst of them was is the only honest measure of how much the shape can be
 * trusted. A corner marked under a thorn tree at 40 m moves a fence by 40 m in a document someone
 * may later rely on.
 *
 * `coords.accuracy` is the 95% confidence radius in metres and is required by the Geolocation spec,
 * so it is always a number — but a phone that reports a nonsense value must not make the corner
 * unrecordable, so it is floored at 0 rather than validated away.
 */
export function currentFix(): Promise<CoordinateFixResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }

  return new Promise<CoordinateFixResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          lon: position.coords.longitude,
          lat: position.coords.latitude,
          accuracyM: Math.max(0, position.coords.accuracy),
        }),
      (error) => resolve({ ok: false, reason: failureOf(error) }),
      // Same options as `currentPoint`, and for the same reasons — in particular `maximumAge: 0`.
      // A cached fix from the last corner would silently mark this corner in the same place, and a
      // farmer walking a fence would produce a ring of identical points without being told.
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

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
      (error) => resolve({ ok: false, reason: failureOf(error) }),
      // No `maximumAge`: a last-seen point that is actually where the phone was an hour ago is
      // worse than no point, because it looks authoritative on a document handed to the police.
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}
