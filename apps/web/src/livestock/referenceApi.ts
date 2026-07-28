/**
 * Reading regulated reference data (FR-131). Unlike every other client in this folder this is an
 * INBOUND fetch — it brings rows the server owns down to the device so the crush works offline.
 *
 * It is called opportunistically by the cache provider, never from a capture path: a farmer's Save
 * must not wait on it, and a failure here is an older product list, not an error.
 */

import type { StoredVetProduct } from './LocalVetProducts';
import type { StoredSpeciesGestation } from './LocalSpeciesGestation';
import { AuthApiError, NetworkUnavailableError } from '../auth/api';

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

/** Fetch a reference list, with the one error taxonomy every inbound read here shares. */
async function readReference<T>(path: string, accessToken: string, whatFailed: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new NetworkUnavailableError();
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}));
    const { code, message } = payload as { code?: string; message?: string };
    throw new AuthApiError(code ?? 'UNKNOWN', message ?? whatFailed, response.status);
  }
  return (await response.json()) as T;
}

export const referenceApi = {
  async listVeterinaryProducts(farmId: string, accessToken: string): Promise<StoredVetProduct[]> {
    return readReference<StoredVetProduct[]>(
      `/reference/veterinary-products?farmId=${encodeURIComponent(farmId)}`,
      accessToken,
      'Could not read the product register',
    );
  },

  /**
   * The species gestation figures a due date is projected from (FR-121). No `onDay` and no
   * jurisdiction: biology neither changes on a date nor stops at a border, so there is nothing to
   * resolve it for. The farm is sent to prove membership, not to filter.
   */
  async listSpeciesGestation(
    farmId: string,
    accessToken: string,
  ): Promise<StoredSpeciesGestation[]> {
    return readReference<StoredSpeciesGestation[]>(
      `/reference/species-gestation?farmId=${encodeURIComponent(farmId)}`,
      accessToken,
      'Could not read the gestation figures',
    );
  },
};
