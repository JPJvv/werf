/**
 * Client subscription management for offline-sync.md §3's event read-set window.
 *
 * PowerSync deliberately cannot compare a row timestamp to a moving client cutoff. Its supported
 * time-sync pattern is equality buckets: the stream compares `YYYY-MM` to a subscription
 * parameter, and the client holds one subscription per retained UTC month. Unsubscribing with a
 * zero TTL removes an expired bucket from local SQLite; queued writes live in separate local-only
 * tables and are therefore never touched by this read-set degradation.
 */

import type { LocalDatabase } from './local-database';

export const DEFAULT_EVENT_RETENTION_MONTHS = 24;
export const EVENT_RETENTION_STREAM = 'events';
export const EVENT_RETENTION_RETRY_MS = 30_000;

export interface FarmEventRetention {
  readonly farmId: string;
  readonly months: number;
}

export interface EventRetentionController {
  /** Stops the month-boundary timer and releases active subscriptions. Idempotent. */
  close(): void;
}

interface SubscriptionLike {
  unsubscribe(): unknown;
}

export interface EventRetentionControllerOptions {
  readonly database: Pick<LocalDatabase, 'syncStream'>;
  readonly farms: readonly FarmEventRetention[];
  /** Injected only by deterministic tests; production uses the current clock. */
  readonly now?: () => Date;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** The current UTC month followed by its predecessors, newest first. */
export function eventMonthBuckets(on: Date, count: number): readonly string[] {
  if (!Number.isInteger(count) || count <= 0) return [];

  const year = on.getUTCFullYear();
  const month = on.getUTCMonth();
  return Array.from({ length: count }, (_, offset) => {
    const bucketDate = new Date(Date.UTC(year, month - offset, 1));
    return `${bucketDate.getUTCFullYear()}-${String(bucketDate.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function millisecondsUntilNextUtcMonth(on: Date): number {
  const next = Date.UTC(on.getUTCFullYear(), on.getUTCMonth() + 1, 1);
  return Math.max(1, next - on.getTime());
}

/**
 * Keeps one parameterized event subscription per configured farm/month. New buckets are subscribed
 * before expired ones are released, so crossing midnight never creates a temporary hole. A clean
 * close uses the same zero TTL as expiry: this provider only closes on sign-out/unmount, while a
 * browser kill leaves the durable local database untouched and the next launch recreates the same
 * window from the cached session.
 */
export function createEventRetentionController(
  options: EventRetentionControllerOptions,
): EventRetentionController {
  const now = options.now ?? (() => new Date());
  const schedule = options.setTimer ?? setTimeout;
  const cancel = options.clearTimer ?? clearTimeout;
  const subscriptions = new Map<string, SubscriptionLike>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let revision = 0;

  const reconcile = async (): Promise<void> => {
    const run = ++revision;
    const on = now();
    let subscriptionFailed = false;
    const desired = new Map<string, { farmId: string; month: string }>();
    for (const farm of options.farms) {
      for (const month of eventMonthBuckets(on, farm.months)) {
        desired.set(`${farm.farmId}:${month}`, { farmId: farm.farmId, month });
      }
    }

    // Add first, then remove: a month rollover may overlap by one bucket but never has a gap.
    await Promise.all(
      [...desired.entries()].map(async ([key, params]) => {
        if (closed || subscriptions.has(key)) return;
        try {
          const subscription = await options.database
            .syncStream(EVENT_RETENTION_STREAM, {
              farm_id: params.farmId,
              month: params.month,
            })
            .subscribe({ ttl: 0 });
          if (closed || run !== revision) {
            subscription.unsubscribe();
            return;
          }
          subscriptions.set(key, subscription);
        } catch {
          // Down-sync remains a background enhancement, so capture never waits on this path. A
          // short controller-owned retry avoids leaving the whole event read set absent until the
          // next month boundary if subscription registration itself failed while offline.
          subscriptionFailed = true;
        }
      }),
    );

    if (closed || run !== revision) return;
    for (const [key, subscription] of subscriptions) {
      if (desired.has(key)) continue;
      subscription.unsubscribe();
      subscriptions.delete(key);
    }

    if (timer !== null) cancel(timer);
    timer = schedule(
      () => void reconcile(),
      subscriptionFailed
        ? Math.min(EVENT_RETENTION_RETRY_MS, millisecondsUntilNextUtcMonth(on))
        : millisecondsUntilNextUtcMonth(on),
    );
  };

  void reconcile();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      revision += 1;
      if (timer !== null) cancel(timer);
      timer = null;
      for (const subscription of subscriptions.values()) subscription.unsubscribe();
      subscriptions.clear();
    },
  };
}
