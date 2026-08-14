import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { SyncStatusStrip } from '../sync/SyncStatusStrip';
import { OutboxProvider } from '../sync/Outbox';
import { SyncConnectionProvider } from '../sync/SyncConnection';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { FarmSwitcher } from './FarmSwitcher';
import { LocalLandProvider } from '../land/LocalLand';
import { HydratedLandProvider } from '../land/HydratedLand';
import { LocalHerdProvider } from '../livestock/LocalHerd';
import { LocalMobsProvider } from '../livestock/LocalMobs';
import { LocalTalliesProvider } from '../livestock/LocalTallies';
import { HydratedLivestockProvider } from '../livestock/HydratedLivestock';
import { LocalIdentifiersProvider } from '../livestock/LocalIdentifiers';
import { LocalWeightsProvider } from '../livestock/LocalWeights';
import { LocalLifecycleProvider } from '../livestock/LocalLifecycle';
import { LocalMovesProvider } from '../livestock/LocalMoves';
import { LocalHealthProvider } from '../livestock/LocalHealth';
import { LocalVetProductsProvider } from '../livestock/LocalVetProducts';
import { LocalResidueRegisterProvider } from '../livestock/LocalResidueRegister';
import { LocalBreedingProvider } from '../livestock/LocalBreeding';
import { LocalSpeciesGestationProvider } from '../livestock/LocalSpeciesGestation';
import { LocalTheftProvider } from '../livestock/LocalTheft';
import { LocalRainfallProvider } from '../rainfall/LocalRainfall';
import { LocalAttachmentsProvider } from '../attachments/LocalAttachments';

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
  // Also not a capture store — the DOWN-SYNC half of land (phase-checklists.md 3e, land hydration —
  // closed 2026-08-14). `LocalLand.tsx`'s `useEffectiveLandUnits`/`useEffectiveBoundaryWalks` and
  // `Outbox.tsx` both read it, so it has to sit above both, same as `HydratedLivestockProvider` below.
  HydratedLandProvider,
  LocalMobsProvider,
  LocalTalliesProvider,
  LocalHerdProvider,
  LocalIdentifiersProvider,
  LocalWeightsProvider,
  LocalLifecycleProvider,
  LocalMovesProvider,
  LocalHealthProvider,
  LocalVetProductsProvider,
  // Not a capture store — an INBOUND cache, like the product register beside it. It is here rather
  // than around the one screen that reads it because the home link carries its count, and a count
  // that only appears once you have opened the screen is a count nobody sees.
  LocalResidueRegisterProvider,
  LocalBreedingProvider,
  LocalSpeciesGestationProvider,
  LocalTheftProvider,
  LocalRainfallProvider,
  // Split-store like `LocalLand` above — its blob half lives in OPFS, not the SQLite-backed
  // metadata table this list otherwise composes (phase-checklists.md 3i(c)).
  LocalAttachmentsProvider,
  // Also not a capture store — the DOWN-SYNC half of mobs/tallies (phase-checklists.md 3e).
  // `Outbox.tsx` and `herd.ts` both read it, so it has to sit above both, same as
  // `LocalMobsProvider`/`LocalTalliesProvider` above it in this list.
  HydratedLivestockProvider,
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
          {/* No visual output — owns the app's ONE down-sync connection (phase-checklists.md 3e).
              Inside CaptureStores/OutboxProvider only because it needs no context from either;
              placed here rather than higher up so it mounts/unmounts on the same authenticated
              lifetime as everything that reads what it hydrates. */}
          <SyncConnectionProvider>
            <SyncStatusStrip />
            <main>
              <Outlet />
            </main>
          </SyncConnectionProvider>
        </OutboxProvider>
      </CaptureStores>
      <InstallPrompt />
    </div>
  );
}
