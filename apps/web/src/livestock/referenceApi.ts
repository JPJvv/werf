/**
 * Reading regulated reference data (FR-131). Unlike every other client in this folder this is an
 * INBOUND fetch — it brings rows the server owns down to the device so the crush works offline.
 *
 * It is called opportunistically by the cache provider, never from a capture path: a farmer's Save
 * must not wait on it, and a failure here is an older product list, not an error.
 */

import type { StoredVetProduct } from './LocalVetProducts';
import { AuthApiError, NetworkUnavailableError } from '../auth/api';

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

export const referenceApi = {
  async listVeterinaryProducts(farmId: string, accessToken: string): Promise<StoredVetProduct[]> {
    let response: Response;
    try {
      response = await fetch(
        `${API_BASE}/reference/veterinary-products?farmId=${encodeURIComponent(farmId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    } catch {
      throw new NetworkUnavailableError();
    }
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => ({}));
      const { code, message } = payload as { code?: string; message?: string };
      throw new AuthApiError(
        code ?? 'UNKNOWN',
        message ?? 'Could not read the product register',
        response.status,
      );
    }
    return (await response.json()) as StoredVetProduct[];
  },
};
