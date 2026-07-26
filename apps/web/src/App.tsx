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
import { TagSessionScreen } from './livestock/TagSessionScreen';
import { AddMobScreen } from './livestock/AddMobScreen';
import { MoveAnimalsScreen } from './livestock/MoveAnimalsScreen';
import { RecordBirthScreen } from './livestock/RecordBirthScreen';
import { WeaningSessionScreen } from './livestock/WeaningSessionScreen';
import { RecordHealthScreen } from './livestock/RecordHealthScreen';
import { RecordLossScreen } from './livestock/RecordLossScreen';
import { TheftIncidentsScreen } from './livestock/TheftIncidentsScreen';
import { ReportTheftScreen } from './livestock/ReportTheftScreen';
import { LandScreen } from './land/LandScreen';
import { AddLandUnitScreen } from './land/AddLandUnitScreen';
import { RecordRainfallScreen } from './rainfall/RecordRainfallScreen';
import { NotSentScreen } from './sync/NotSentScreen';
import { ModulePlaceholder } from './shell/ModulePlaceholder';
import { SettingsLayout } from './settings/SettingsLayout';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { LanguageSettings } from './settings/LanguageSettings';
import { FarmsSettings } from './settings/FarmsSettings';

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
                <Route path="animals/tag" element={<TagSessionScreen />} />
                <Route path="animals/groups/new" element={<AddMobScreen />} />
                <Route path="animals/move" element={<MoveAnimalsScreen />} />
                <Route path="animals/birth" element={<RecordBirthScreen />} />
                <Route path="animals/wean" element={<WeaningSessionScreen />} />
                <Route path="animals/health" element={<RecordHealthScreen />} />
                {/* The list sits at the parent path and the capture below it, because a farmer
                    coming back a week later wants the incident they filed and its pack, not the
                    form again (FR-603). */}
                <Route path="animals/theft" element={<TheftIncidentsScreen />} />
                <Route path="animals/theft/new" element={<ReportTheftScreen />} />
                <Route path="weigh" element={<WeighSessionScreen />} />
                {/* Land is farm-level, not livestock: a camp and a block are one table (FR-150). */}
                <Route path="land" element={<LandScreen />} />
                <Route path="land/new" element={<AddLandUnitScreen />} />
                {/* Rainfall is farm-level, not livestock: both enterprises read it (FR-213). */}
                <Route path="rainfall" element={<RecordRainfallScreen />} />
                {/* Reached from the sync strip when the server has refused something (FR-009). */}
                <Route path="not-sent" element={<NotSentScreen />} />
                <Route path="settings" element={<SettingsLayout />}>
                  <Route index element={<Navigate to="appearance" replace />} />
                  <Route path="appearance" element={<AppearanceSettings />} />
                  <Route path="language" element={<LanguageSettings />} />
                  <Route path="farms" element={<FarmsSettings />} />
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
