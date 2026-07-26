import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import type { SyncState, SyncStatus } from './useSyncStatus';
import { useSyncState } from './Outbox';

/**
 * A persistent, non-modal strip that always says whether work is saved and sent (FR-009).
 * Meaning is never in colour alone — the words carry it, colour only reinforces (NFR-411) —
 * and it is a polite live region so a screen reader announces a change without interrupting.
 *
 * ⭐ When — and only when — the server has REFUSED something, the strip also carries a way to go
 * and see what. "3 need your attention" with nowhere to look is a worry rather than a task. The
 * link is rendered conditionally rather than always, which is also what keeps this component
 * usable outside a router: with nothing refused there is no `<Link>` to resolve, and its unit test
 * renders it on its own.
 *
 * The link sits OUTSIDE the live region. Inside it, every re-announcement would drag the control
 * along with it, and a polite region that keeps re-reading a link is the opposite of polite.
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
  // A refusal outranks the generic error: "will retry" is true of a dropped signal and false of a
  // record the server has rejected on its merits, and the farmer needs to know which one they have.
  if (state.blockedCount > 0) return `${state.blockedCount} ${t('sync.blocked')}`;
  if (state.status === 'pending') return `${state.pendingCount} ${t('sync.toSend')}`;
  return t(STATUS_TEXT_KEY[state.status]);
}

export function SyncStatusStrip() {
  const state = useSyncState();
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-2 border-b border-soil-200 bg-sand-100 px-4 py-2">
      <div
        role="status"
        aria-live="polite"
        aria-label={t('sync.status.label')}
        className={`flex items-center gap-2 text-body ${STATUS_COLOR[state.status]}`}
      >
        <span aria-hidden="true">⌁</span>
        <span>{statusText(state, t)}</span>
      </div>
      {state.blockedCount > 0 && (
        <Link to="/not-sent" className="shrink-0 text-body text-dam-700">
          {t('sync.blocked.see')}
        </Link>
      )}
    </div>
  );
}
