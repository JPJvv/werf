import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LocaleProvider } from './i18n/LocaleProvider';
import { AppShell } from './shell/AppShell';
import { HomeScreen } from './shell/HomeScreen';
import { ModulePlaceholder } from './shell/ModulePlaceholder';
import { SettingsLayout } from './settings/SettingsLayout';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { LanguageSettings } from './settings/LanguageSettings';

/**
 * Phase 1 app shell + routing. LocaleProvider wraps everything so any screen can translate
 * (FR-008). The home screen is the enterprise-adaptive grid (FR-017); tiles are doors to
 * module routes that fill in with their phases. The auth guard and offline session gate land
 * in later slices.
 */
export function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomeScreen />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="appearance" replace />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              <Route path="language" element={<LanguageSettings />} />
            </Route>
            <Route path=":module" element={<ModulePlaceholder />} />
            <Route path="*" element={<ModulePlaceholder />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  );
}
