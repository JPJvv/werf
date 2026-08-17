import { describe, expect, it, vi } from 'vitest';
import {
  createEventRetentionController,
  EVENT_RETENTION_RETRY_MS,
  eventMonthBuckets,
  type EventRetentionControllerOptions,
} from '../src/index';

describe('event retention equality buckets', () => {
  it('builds the configured UTC calendar-month window across a year boundary', () => {
    expect(eventMonthBuckets(new Date('2026-02-15T12:00:00Z'), 4)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });

  it('subscribes per farm and month, then releases every bucket on close with ttl zero', async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(async () => ({ unsubscribe }));
    const syncStream = vi.fn(() => ({ subscribe }));
    const scheduled: Array<() => void> = [];

    const controller = createEventRetentionController({
      database: { syncStream } as unknown as EventRetentionControllerOptions['database'],
      farms: [
        { farmId: 'farm-a', months: 2 },
        { farmId: 'farm-b', months: 1 },
      ],
      now: () => new Date('2026-02-15T12:00:00Z'),
      setTimer: (callback) => {
        scheduled.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
    });

    await vi.waitFor(() => expect(syncStream).toHaveBeenCalledTimes(3));
    expect(syncStream.mock.calls).toEqual([
      ['events', { farm_id: 'farm-a', month: '2026-02' }],
      ['events', { farm_id: 'farm-a', month: '2026-01' }],
      ['events', { farm_id: 'farm-b', month: '2026-02' }],
    ]);
    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(subscribe).toHaveBeenCalledWith({ ttl: 0 });
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));

    controller.close();
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });

  it('retries a failed subscription promptly instead of waiting for the next month', async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi
      .fn<() => Promise<{ unsubscribe(): void }>>()
      .mockRejectedValueOnce(new Error('temporarily offline'))
      .mockResolvedValue({ unsubscribe });
    const syncStream = vi.fn(() => ({ subscribe }));
    const scheduled: Array<{ callback: () => void; delay: number }> = [];

    const controller = createEventRetentionController({
      database: { syncStream } as unknown as EventRetentionControllerOptions['database'],
      farms: [{ farmId: 'farm-a', months: 1 }],
      now: () => new Date('2026-02-15T12:00:00Z'),
      setTimer: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
    });

    await vi.waitFor(() => expect(scheduled).toHaveLength(1));
    expect(scheduled[0]?.delay).toBe(EVENT_RETENTION_RETRY_MS);
    scheduled[0]?.callback();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));

    controller.close();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
