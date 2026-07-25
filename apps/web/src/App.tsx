import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LocaleProvider } from './i18n/LocaleProvider';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { SignInScreen } from './auth/SignInScreen';
import { RegisterScreen } from './auth/RegisterScreen';
import { SecondFactorEnrolmentScreen } from './auth/SecondFactorEnrolmentScreen';
import { AppShell } from './shell/AppShell';
import { HomeScreen } from './shell/HomeScreen';
import { AnimalsScreen } from './livestock/AnimalsScreen';
import { AddAnimalScreen } from './livestock/AddAnimalScreen';
import { WeighSessionScreen } from './livestock/WeighSessionScreen';
import { RecordLossScreen } from './livestock/RecordLossScreen';
import { RecordRainfallScreen } from './rainfall/RecordRainfallScreen';
import { ModulePlaceholder } from './shell/ModulePlaceholder';
import { SettingsLayout } from './settings/SettingsLayout';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { LanguageSettings } from './settings/LanguageSettings';

/**
 * Phase 1 app shell + routing.
 *
 * Provider order is load-bearing. `LocaleProvider` is outermost because sign-in and
 * onboarding must speak the farmer's language before any account exists — locale is a
 * device preference until then, and a property of the user afterwards (FR-008).
 * `AuthProvider` sits inside it and hydrates the session synchronously from the local
 * store, so the guard below already knows the answer on the very first render: a cold
 * start with no signal never flashes a login screen at someone who is signed in (FR-006).
 */
export function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Reachable signed out. Everything else sits behind the guard. */}
            <Route path="/sign-in" element={<SignInScreen />} />
            <Route path="/register" element={<RegisterScreen />} />

            <Route element={<RequireAuth />}>
              {/* Outside the shell on purpose: an account that still owes a second factor
                  has no working navigation, because the API refuses every other route. */}
              <Route path="/security/second-factor" element={<SecondFactorEnrolmentScreen />} />

              <Route element={<AppShell />}>
                <Route index element={<HomeScreen />} />
                {/* Explicit livestock routes sit BEFORE the `:module` catch-all so they win. */}
                <Route path="animals" element={<AnimalsScreen />} />
                <Route path="animals/new" element={<AddAnimalScreen />} />
                <Route path="animals/loss" element={<RecordLossScreen />} />
                <Route path="weigh" element={<WeighSessionScreen />} />
                {/* Rainfall is farm-level, not livestock: both enterprises read it (FR-213). */}
                <Route path="rainfall" element={<RecordRainfallScreen />} />
                <Route path="settings" element={<SettingsLayout />}>
                  <Route index element={<Navigate to="appearance" replace />} />
                  <Route path="appearance" element={<AppearanceSettings />} />
                  <Route path="language" element={<LanguageSettings />} />
                </Route>
                <Route path=":module" element={<ModulePlaceholder />} />
                <Route path="*" element={<ModulePlaceholder />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LocaleProvider>
  );
}
