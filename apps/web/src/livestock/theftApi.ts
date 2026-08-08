/**
 * The stock-theft evidence pack (FR-603) — the ONE genuinely online-only action in livestock, and
 * the reason it sits in its own module rather than beside the capture endpoints in `livestockApi`.
 *
 * The two have opposite contracts and must not be confused:
 *
 *  • A capture (`livestockApi`) is best-effort and invisible. It is queued, retried, at-least-once,
 *    and no farmer ever waits on it. Its failure mode is "still to send".
 *  • This is a REQUEST, made deliberately, that a person is standing there waiting for. It cannot
 *    be queued, because there is no useful thing to hand someone later: the pack is a rendered PDF
 *    of the facts as the SERVER holds them, and until the incident has reached the server there is
 *    nothing to render. Its failure mode is a sentence a farmer has to read.
 *
 * The PDF is rendered server-side on purpose (architecture.md): it is a document handed to the SAPS
 * Stock Theft Unit, assembled from the ownership chain and the brand register, and a client-rendered
 * version of that is a document whose contents the farmer's own device chose.
 */

import { AuthApiError, NetworkUnavailableError } from '../auth/api';

/** Where the API lives. Same origin in production; Vite proxies it in dev. Mirrors auth/api.ts. */
const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

export const theftApi = {
  /**
   * Generate the evidence pack for an incident and return the PDF bytes.
   *
   * Errors use the same taxonomy as every other client here, so the screen can tell "no signal"
   * from "the server said no" and say different things about them — a farmer told "no connection"
   * when the real answer is "we have never seen this incident" will drive somewhere with signal and
   * get the same nothing.
   */
  async generateEvidencePack(incidentId: string, accessToken: string): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/livestock/theft-incidents/${incidentId}/evidence-pack`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new NetworkUnavailableError();
    }

    if (!response.ok) {
      // The error body is JSON even though a success is a PDF, so it is read separately and
      // defensively — a proxy's HTML error page must not become an unhandled parse crash.
      const payload: unknown = await response.json().catch(() => ({}));
      const { code, message } = payload as { code?: string; message?: string };
      throw new AuthApiError(
        code ?? 'UNKNOWN',
        message ?? 'The evidence pack could not be generated',
        response.status,
      );
    }

    return response.blob();
  },
};
