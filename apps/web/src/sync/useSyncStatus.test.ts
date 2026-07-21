import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSyncStatus } from './useSyncStatus';

describe('useSyncStatus (FR-009)', () => {
  it('reports saved-and-sent while online', () => {
    const { result } = renderHook(() => useSyncStatus());
    expect(result.current.status).toBe('synced');
  });

  it('flips to offline when connectivity drops and back when it returns', () => {
    const { result } = renderHook(() => useSyncStatus());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.status).toBe('offline');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.status).toBe('synced');
  });
});
