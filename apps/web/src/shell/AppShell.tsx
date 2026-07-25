import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { SyncStatusStrip } from '../sync/SyncStatusStrip';
import { OutboxProvider } from '../sync/Outbox';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { LocalLandProvider } from '../land/LocalLand';
import { LocalHerdProvider } from '../livestock/LocalHerd';
import { LocalIdentifiersProvider } from '../livestock/LocalIdentifiers';
import { LocalWeightsProvider } from '../livestock/LocalWeights';
import { LocalLifecycleProvider } from '../livestock/LocalLifecycle';
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
export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-sand-50 text-soil-900">
      <header className="flex items-center justify-between border-b border-soil-200 px-4 py-2">
        <Link to="/" className="font-ui text-h2 text-soil-900 no-underline">
          Werf
        </Link>
        <nav>
          <Link
            to="/settings"
            className="flex min-h-touch-min items-center px-3 text-body text-soil-700 no-underline"
          >
            {t('nav.settings')}
          </Link>
        </nav>
      </header>
      {/* Land is outermost of the capture stores because it is the one thing the others point AT:
          an animal is put in a camp, and the outbox sends camps before animals for the same reason. */}
      <LocalLandProvider>
        <LocalHerdProvider>
          <LocalIdentifiersProvider>
            <LocalWeightsProvider>
              <LocalLifecycleProvider>
                <LocalRainfallProvider>
                  <OutboxProvider>
                    <SyncStatusStrip />
                    <main>
                      <Outlet />
                    </main>
                  </OutboxProvider>
                </LocalRainfallProvider>
              </LocalLifecycleProvider>
            </LocalWeightsProvider>
          </LocalIdentifiersProvider>
        </LocalHerdProvider>
      </LocalLandProvider>
      <InstallPrompt />
    </div>
  );
}
