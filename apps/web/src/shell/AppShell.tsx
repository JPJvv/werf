import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { SyncStatusStrip } from '../sync/SyncStatusStrip';
import { InstallPrompt } from '../pwa/InstallPrompt';

/**
 * The persistent frame around every screen. A slim top bar with the product mark and a way
 * into Settings; the sync-status strip (FR-009) sits beneath the header, the routed screen
 * renders in the outlet below, and the PWA install prompt anchors at the foot.
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
      <SyncStatusStrip />
      <main>
        <Outlet />
      </main>
      <InstallPrompt />
    </div>
  );
}
