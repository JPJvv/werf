import { useTranslation } from '../i18n/LocaleProvider';
import { useInstallPrompt } from './useInstallPrompt';

/**
 * A non-modal, dismissible banner offering to install the app. Shown only when the browser
 * has signalled the app is install-worthy (FR-007). "Install" is the one primary action;
 * "Not now" leaves without guilt (frontend rules: never nag, never apologise).
 */
export function InstallPrompt() {
  const { canInstall, promptInstall, dismiss } = useInstallPrompt();
  const { t } = useTranslation();

  if (!canInstall) return null;

  return (
    <aside
      aria-label={t('install.title')}
      className="flex flex-col gap-2 border-t border-soil-200 bg-sand-100 p-4"
    >
      <span className="text-body text-soil-900">{t('install.title')}</span>
      <span className="text-body text-soil-700">{t('install.body')}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={promptInstall}
          className="flex min-h-touch-primary items-center rounded bg-ochre-500 px-4 text-body text-soil-900"
        >
          {t('install.action')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="flex min-h-touch-min items-center px-2 text-body text-soil-700"
        >
          {t('install.dismiss')}
        </button>
      </div>
    </aside>
  );
}
