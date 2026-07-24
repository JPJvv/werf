import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import type { SyncState, SyncStatus } from './useSyncStatus';
import { useSyncState } from './Outbox';

/**
 * A persistent, non-modal strip that always says whether work is saved and sent (FR-009).
 * Meaning is never in colour alone — the words carry it, colour only reinforces (NFR-411) —
 * and it is a polite live region so a screen reader announces a change without interrupting.
 */

const STATUS_TEXT_KEY: Record<Exclude<SyncStatus, 'pending'>, TranslationKey> = {
  synced: 'sync.synced',
  offline: 'sync.offline',
  syncing: 'sync.syncing',
  error: 'sync.error',
};

const STATUS_COLOR: Record<SyncStatus, string> = {
  synced: 'text-aloe-700',
  offline: 'text-dam-700',
  pending: 'text-dam-700',
  syncing: 'text-dam-700',
  error: 'text-rooigrond-600',
};

function statusText(state: SyncState, t: (key: TranslationKey) => string): string {
  if (state.status === 'pending') return `${state.pendingCount} ${t('sync.toSend')}`;
  return t(STATUS_TEXT_KEY[state.status]);
}

export function SyncStatusStrip() {
  const state = useSyncState();
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('sync.status.label')}
      className={`flex items-center gap-2 border-b border-soil-200 bg-sand-100 px-4 py-2 text-body ${STATUS_COLOR[state.status]}`}
    >
      <span aria-hidden="true">⌁</span>
      <span>{statusText(state, t)}</span>
    </div>
  );
}
