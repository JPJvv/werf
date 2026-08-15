import type { schemas } from '@werf/core';
import { postCapture, readFromApi } from '../sync/captureApi';

export const conflictsApi = {
  listOpen: (farmId: string, token: string): Promise<schemas.ConflictReviewJson[]> =>
    readFromApi<schemas.ConflictReviewJson[]>(
      `/conflicts?farmId=${encodeURIComponent(farmId)}`,
      token,
      'Could not read the conflict review list',
    ),

  markReviewed: (id: string, farmId: string, token: string): Promise<void> =>
    postCapture(`/conflicts/${encodeURIComponent(id)}/review`, { farmId }, token),
};
