import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { HomeScreen } from './shell/HomeScreen';
import { ModulePlaceholder } from './shell/ModulePlaceholder';
import { AppearanceSettings } from './settings/AppearanceSettings';

/**
 * Phase 1 app shell + routing. Everything renders inside AppShell (the persistent frame).
 * The home screen is the enterprise-adaptive grid (FR-017); tiles are doors to module routes
 * that fill in with their phases. The auth guard and offline session gate land in later slices.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomeScreen />} />
          <Route path="settings/appearance" element={<AppearanceSettings />} />
          <Route path=":module" element={<ModulePlaceholder />} />
          <Route path="*" element={<ModulePlaceholder />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
