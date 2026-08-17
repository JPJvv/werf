/**
 * `retryDurably` (`../src/durable-retry`) — the seam `opfs-blob-store.ts` uses to give an
 * attachment blob the same "never rejected, never silently dropped" guarantee
 * `sqlite-capture-store.ts`'s persistence coordinator already gives `capture_records` (P1.1).
 * Reviewer finding (2026-08-17, sixteenth session): a real OPFS `QuotaExceededError` inside
 * `useRecordAttachment` propagated straight up, uncaught, before any metadata row was written —
 * a farmer's photo was silently lost with the screen frozen on "Saving…". This spec proves the
 * fix's actual retry mechanics against a controllable fake failure, since `navigator.storage`
 * does not exist under plain Node and the real adapter is deliberately Playwright-only
 * (`opfs-blob-store.ts`'s own header).
 */

import { describe, expect, it, vi } from 'vitest';
import { retryDurably } from '../src/durable-retry';

const INTERVAL_MS = 5_000;

describe('retryDurably', () => {
  it('resolves with the attempt result once it succeeds', async () => {
    const result = await retryDurably(async () => 'landed', INTERVAL_MS);
    expect(result).toBe('landed');
  });

  it('⭐ retries on quota pressure and resolves once space frees up, without ever rejecting', async () => {
    vi.useFakeTimers();
    try {
      let quotaExceeded = true;
      const attempt = vi.fn(async () => {
        if (quotaExceeded) throw new DOMException('storage full', 'QuotaExceededError');
        return 'blob written';
      });

      let resolved: string | null = null;
      const promise = retryDurably(attempt, INTERVAL_MS).then((value) => {
        resolved = value;
      });

      // First attempt fails immediately — the promise must stay pending, not reject. A farmer's
      // capture screen awaiting this is still showing "Saving…", truthfully, not frozen on a
      // photo that was actually dropped.
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBeNull();
      expect(attempt).toHaveBeenCalledTimes(1);

      // Quota pressure clears while the app is still open — the same "no reload needed" recovery
      // sqlite-capture-store.ts's own quota test proves for the metadata half.
      quotaExceeded = false;
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await promise;
      expect(resolved).toBe('blob written');
    } finally {
      vi.useRealTimers();
    }
  });

  it('⭐ never gives up — three consecutive failures still leave the promise pending, not rejected', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const attempt = vi.fn(async () => {
        attempts += 1;
        if (attempts <= 3) throw new DOMException('storage full', 'QuotaExceededError');
        return 'landed';
      });

      let settled = false;
      let rejected = false;
      const promise = retryDurably(attempt, INTERVAL_MS).then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
          rejected = true;
        },
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(settled).toBe(false); // three failures in — still retrying, never rejected
      expect(attempts).toBe(3);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await promise;
      expect(settled).toBe(true);
      expect(rejected).toBe(false);
      expect(attempts).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
