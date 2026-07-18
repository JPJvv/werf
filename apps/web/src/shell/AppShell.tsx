import { Link, Outlet } from 'react-router-dom';

/**
 * The persistent frame around every screen. A slim top bar with the product mark and a way
 * into Settings; the routed screen renders in the outlet below. The sync-status strip
 * (FR-009) and the offline session gate land in later slices — this is the skeleton they
 * hang on.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-sand-50 text-soil-900">
      <header className="flex items-center justify-between border-b border-soil-200 px-4 py-2">
        <Link to="/" className="font-ui text-h2 text-soil-900 no-underline">
          Werf
        </Link>
        <nav>
          <Link
            to="/settings/appearance"
            className="flex min-h-touch-min items-center px-3 text-body text-soil-700 no-underline"
          >
            Settings
          </Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
