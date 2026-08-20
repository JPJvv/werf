/**
 * Reading regulated reference data (FR-131). Unlike every other client in this folder this is an
 * INBOUND fetch — it brings rows the server owns down to the device so the crush works offline.
 *
 * It is called opportunistically by the cache provider, never from a capture path: a farmer's Save
 * must not wait on it, and a failure here is an older product list, not an error.
 */

import type { StoredVetProduct } from './LocalVetProducts';
import type { StoredSpeciesGestation } from './LocalSpeciesGestation';
import type { StoredChemicalProduct } from '../crops/LocalChemicalProducts';
// The transport and the one error taxonomy every inbound read shares — the same file the outbound
// half lives in, so the two cannot come to disagree about what a 401 or a dropped socket means.
import { readFromApi as readReference } from '../sync/captureApi';

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

  /**
   * The chemical products a spray may resolve a PHI against (FR-204/FR-508). Same P1.3 discipline
   * as `listVeterinaryProducts`: no `onDay`, so the device holds every registered version this
   * farm's jurisdiction has ever had.
   */
  async listChemicalProducts(
    farmId: string,
    accessToken: string,
  ): Promise<StoredChemicalProduct[]> {
    return readReference<StoredChemicalProduct[]>(
      `/reference/chemical-products?farmId=${encodeURIComponent(farmId)}`,
      accessToken,
      'Could not read the chemical product register',
    );
  },
};
