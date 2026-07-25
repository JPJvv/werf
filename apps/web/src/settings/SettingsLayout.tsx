import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';

/**
 * The Settings area frame: a sub-nav between the settings screens, with the chosen one shown
 * in the outlet. Appearance and Language today; more settings hang here as they arrive.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-touch-min items-center px-3 text-body no-underline ${
      isActive ? 'text-soil-900' : 'text-soil-700'
    }`;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label={t('nav.settings')} className="flex gap-2 border-b border-soil-200 px-4">
        <NavLink to="appearance" className={linkClass}>
          {t('settings.appearance.title')}
        </NavLink>
        <NavLink to="farms" className={linkClass}>
          {t('settings.farms.title')}
        </NavLink>
        <NavLink to="language" className={linkClass}>
          {t('settings.language.title')}
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
