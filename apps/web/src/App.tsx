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
import { AdjustMobScreen } from './livestock/AdjustMobScreen';
import { MoveAnimalsScreen } from './livestock/MoveAnimalsScreen';
import { RecordMatingScreen } from './livestock/RecordMatingScreen';
import { RecordPregnancyScreen } from './livestock/RecordPregnancyScreen';
import { RecordBirthScreen } from './livestock/RecordBirthScreen';
import { WeaningSessionScreen } from './livestock/WeaningSessionScreen';
import { RecordHealthScreen } from './livestock/RecordHealthScreen';
import { RecordLossScreen } from './livestock/RecordLossScreen';
import { RecordPhotoScreen } from './livestock/RecordPhotoScreen';
import { TheftIncidentsScreen } from './livestock/TheftIncidentsScreen';
import { AttentionScreen } from './livestock/AttentionScreen';
import { BrandingRegisterScreen } from './livestock/BrandingRegisterScreen';
import { ReportTheftScreen } from './livestock/ReportTheftScreen';
import { LandScreen } from './land/LandScreen';
import { AddLandUnitScreen } from './land/AddLandUnitScreen';
import { WalkBoundaryScreen } from './land/WalkBoundaryScreen';
import { SplitBlockScreen } from './land/SplitBlockScreen';
import { RecordPlantingScreen } from './crops/RecordPlantingScreen';
import { RecordFertiliserScreen } from './crops/RecordFertiliserScreen';
import { RecordSprayScreen } from './crops/RecordSprayScreen';
import { SpraysScreen } from './crops/SpraysScreen';
import { RecordHarvestScreen } from './crops/RecordHarvestScreen';
import { HarvestScreen } from './crops/HarvestScreen';
import { RecordRainfallScreen } from './rainfall/RecordRainfallScreen';
import { NotSentScreen } from './sync/NotSentScreen';
import { ModulePlaceholder } from './shell/ModulePlaceholder';
import { SettingsLayout } from './settings/SettingsLayout';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { LanguageSettings } from './settings/LanguageSettings';
import { FarmsSettings } from './settings/FarmsSettings';
import { SecuritySettings } from './settings/SecuritySettings';

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
                <Route path="animals/photo" element={<RecordPhotoScreen />} />
                <Route path="animals/brands" element={<BrandingRegisterScreen />} />
                <Route path="animals/tag" element={<TagSessionScreen />} />
                <Route path="animals/groups/new" element={<AddMobScreen />} />
                <Route path="animals/groups/count" element={<AdjustMobScreen />} />
                <Route path="animals/move" element={<MoveAnimalsScreen />} />
                <Route path="animals/mating" element={<RecordMatingScreen />} />
                <Route path="animals/pregnancy" element={<RecordPregnancyScreen />} />
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
                {/* Walking a fence with a GPS (FR-150). `?camp=<id>` when reached from one row of
                    the land list; the screen still lets the farmer change which one. */}
                <Route path="land/walk" element={<WalkBoundaryScreen />} />
                <Route path="land/split" element={<SplitBlockScreen />} />
                <Route path="crops/plant" element={<RecordPlantingScreen />} />
                <Route path="crops/fertilise" element={<RecordFertiliserScreen />} />
                <Route path="crops/spray" element={<RecordSprayScreen />} />
                {/* The home grid's "Sprays" tile (`home/tiles.ts`) — registered before the
                    `:module` catch-all so it stops falling through to `ModulePlaceholder`. */}
                <Route path="sprays" element={<SpraysScreen />} />
                <Route path="crops/harvest" element={<RecordHarvestScreen />} />
                {/* The home grid's "harvest" tile (`home/tiles.ts`, `to: '/harvest'`) — registered
                    before the `:module` catch-all for the identical reason `sprays` is, one line
                    up (4d — it was a placeholder until this slice). */}
                <Route path="harvest" element={<HarvestScreen />} />
                {/* Rainfall is farm-level, not livestock: both enterprises read it (FR-213). */}
                <Route path="rainfall" element={<RecordRainfallScreen />} />
                {/* Reached from the sync strip when the server has refused something (FR-009). */}
                <Route path="not-sent" element={<NotSentScreen />} />
                {/* The residue register (FR-131). Farm-level, not livestock-level: it answers for
                    everything that left the herd, and it is reached from home rather than from a
                    tile — the grid's tile set is fixed and generated from the enterprise types. */}
                <Route path="attention" element={<AttentionScreen />} />
                <Route path="settings" element={<SettingsLayout />}>
                  <Route index element={<Navigate to="appearance" replace />} />
                  <Route path="appearance" element={<AppearanceSettings />} />
                  <Route path="language" element={<LanguageSettings />} />
                  <Route path="farms" element={<FarmsSettings />} />
                  <Route path="security" element={<SecuritySettings />} />
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
