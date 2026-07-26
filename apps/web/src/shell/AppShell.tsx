import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { SyncStatusStrip } from '../sync/SyncStatusStrip';
import { OutboxProvider } from '../sync/Outbox';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { FarmSwitcher } from './FarmSwitcher';
import { LocalLandProvider } from '../land/LocalLand';
import { LocalHerdProvider } from '../livestock/LocalHerd';
import { LocalMobsProvider } from '../livestock/LocalMobs';
import { LocalIdentifiersProvider } from '../livestock/LocalIdentifiers';
import { LocalWeightsProvider } from '../livestock/LocalWeights';
import { LocalLifecycleProvider } from '../livestock/LocalLifecycle';
import { LocalMovesProvider } from '../livestock/LocalMoves';
import { LocalHealthProvider } from '../livestock/LocalHealth';
import { LocalVetProductsProvider } from '../livestock/LocalVetProducts';
import { LocalTheftProvider } from '../livestock/LocalTheft';
import { LocalRainfallProvider } from '../rainfall/LocalRainfall';

/**
 * The persistent frame around every screen. A slim top bar with the product mark and a way
 * into Settings; the sync-status strip (FR-009) sits beneath the header, the routed screen
 * renders in the outlet below, and the PWA install prompt anchors at the foot.
 *
 * The capture stores and the outbox wrap BOTH the strip and the routed screens: the screens
 * write captures to the stores, and the outbox reads those same stores to flush them and to
 * publish the pending count the strip shows. Every store is farm-scoped, so switching the active
 * farm swaps the herd, the weights, the events, the rain and the send-state together.
 */
/**
 * Every local capture store, composed in one place.
 *
 * Written as a LIST rather than as nested JSX because the nesting carried no meaning and the
 * pyramid had reached the point where adding a store meant re-indenting all of them — which is
 * exactly when a re-indent quietly drops one, and a dropped provider is a runtime crash on a
 * screen nobody re-opened. The order here is not load-bearing (the stores are independent); the
 * order that IS load-bearing is the outbox's send order, and that lives in the outbox.
 */
const CAPTURE_STORES = [
  LocalLandProvider,
  LocalMobsProvider,
  LocalHerdProvider,
  LocalIdentifiersProvider,
  LocalWeightsProvider,
  LocalLifecycleProvider,
  LocalMovesProvider,
  LocalHealthProvider,
  LocalVetProductsProvider,
  LocalTheftProvider,
  LocalRainfallProvider,
] as const;

function CaptureStores({ children }: { children: ReactNode }) {
  return CAPTURE_STORES.reduceRight<ReactNode>(
    (inner, Provider) => <Provider>{inner}</Provider>,
    children,
  );
}

export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-sand-50 text-soil-900">
      <header className="flex items-center justify-between border-b border-soil-200 px-4 py-2">
        <Link to="/" className="font-ui text-h2 text-soil-900 no-underline">
          Werf
        </Link>
        <nav className="flex items-center gap-2">
          {/* FR-004. On every screen, because "which farm is this?" is the question behind every
              number on it — and hidden entirely on a single-farm account, where a picker with one
              option is furniture. */}
          <FarmSwitcher />
          <Link
            to="/settings"
            className="flex min-h-touch-min items-center px-3 text-body text-soil-700 no-underline"
          >
            {t('nav.settings')}
          </Link>
        </nav>
      </header>
      <CaptureStores>
        <OutboxProvider>
          <SyncStatusStrip />
          <main>
            <Outlet />
          </main>
        </OutboxProvider>
      </CaptureStores>
      <InstallPrompt />
    </div>
  );
}
