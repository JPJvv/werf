/**
 * Attach a photo (phase-checklists.md 3i(c)) — the capture-side entry point for the attachment
 * pipeline. Same "walk the herd, one animal per screen" rhythm as `WeighSessionScreen.tsx`: pick
 * or take a photo, Save & next, down the race.
 *
 * ⭐ `useRecordAttachment` is genuinely ASYNC, unlike every other capture's synchronous
 * `store.append()` — see its own header for why that is not the NFR-007 violation it looks like:
 * checksumming and the OPFS write are local compute, never the network. `save` still commits with
 * no signal anywhere in the path.
 *
 * `capture="environment"` opens the back camera directly on a phone rather than a photo picker —
 * the crush is where this screen is used, and a farmer standing next to an animal wants the camera,
 * not a gallery. It degrades to an ordinary file picker on a device with no camera API, which is
 * the correct fallback rather than a broken one.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveAnimals } from './herd';
import { useAnimalLabels } from './LocalIdentifiers';
import { useRecordAttachment } from '../attachments/LocalAttachments';
import { speciesLabel, sexLabel } from './AnimalsScreen';

export function RecordPhotoScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  // A photo is of an animal still in the herd — there is nothing to photograph of a lost one.
  const animals = useEffectiveAnimals().filter((a) => a.status === 'alive');
  const record = useRecordAttachment();
  const labels = useAnimalLabels();

  const [index, setIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const animal = animals[index];

  if (!activeFarm) return null;

  const canSave = file !== null && !saving;

  const advance = () => {
    setFile(null);
    setIndex((i) => i + 1);
  };

  const save = async () => {
    if (!animal || file === null || saving) return;
    setSaving(true);
    await record({
      subjectType: 'animal',
      subjectId: animal.id,
      mimeType: file.type,
      blob: file,
      occurredAt: new Date().toISOString(),
    });
    setSaving(false);
    setSavedCount((n) => n + 1);
    advance();
  };

  const skip = () => advance();

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('photo.title')}</h1>

      {animals.length === 0 ? (
        <>
          <p className="mb-6 text-body text-soil-700">{t('photo.empty')}</p>
          <Link
            to="/animals/new"
            className="flex min-h-touch-primary items-center justify-center rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action no-underline"
          >
            {t('photo.emptyAction')}
          </Link>
        </>
      ) : animal ? (
        <>
          <p className="mb-1 font-data text-data-lg tabular-nums text-soil-700">
            {`${index + 1} ${t('photo.of')} ${animals.length}`}
          </p>
          <p className="mb-4 text-body text-soil-900">
            {labels.has(animal.id) && (
              <>
                <span className="font-data text-data-lg tabular-nums">{labels.get(animal.id)}</span>
                {' · '}
              </>
            )}
            {speciesLabel(t, animal.species)}
            {' · '}
            {sexLabel(t, animal.sex)}
            {animal.breed ? ` · ${animal.breed}` : ''}
          </p>

          <div className="mb-6 flex flex-col">
            <label htmlFor="photo" className="mb-1 text-label uppercase text-soil-700">
              {t('photo.field')}
            </label>
            <input
              id="photo"
              name="photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 py-2 text-body text-soil-900"
            />
          </div>

          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
          >
            {saving ? t('photo.saving') : t('photo.save')}
          </button>

          <button
            type="button"
            onClick={skip}
            className="mt-4 min-h-touch-min w-full rounded border border-soil-200 px-4 font-ui text-body text-soil-900"
          >
            {t('photo.skip')}
          </button>
        </>
      ) : (
        <>
          <p className="mb-6 text-body text-soil-900">
            <span className="font-data text-data-lg tabular-nums">{savedCount}</span>{' '}
            {t('photo.done.count')}
          </p>
          <Link to="/animals" className="inline-block text-body text-dam-700">
            {t('photo.done.link')}
          </Link>
        </>
      )}

      <Link to="/animals" className="mt-6 block text-body text-dam-700">
        {t('photo.back')}
      </Link>
    </section>
  );
}
