/**
 * Tagging (FR-109) — the crush path for giving animals their numbers, shaped exactly like the weigh
 * session because it is the same job: one animal on screen, one large field, one ochre action, and
 * a thumb that never leaves the button. A farmer tagging a race of weaners does forty of these in a
 * row, and every extra tap is multiplied by forty.
 *
 * Untagged animals come first, because they are why the farmer opened this. An animal that already
 * has a number is not skipped from the list — a second identifier on the same animal is normal, an
 * EID alongside a visual tag — it simply is not what the session is for, so the session ENDS when
 * the untagged ones run out rather than marching on through the whole herd.
 *
 * A number already live on the farm is refused HERE, before it is saved, because in a crush the
 * cause is almost always a misread digit and the fix is to look again — not to discover days later
 * that the queue cannot drain. The server refuses it too (a second device cannot see this one's
 * captures), and says the same thing.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { IDENTIFIER_TYPES, schemas, uuidv7, type IdentifierType } from '@werf/core';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useAuth } from '../auth/AuthProvider';
import { useEffectiveAnimals } from './herd';
import { useAnimalLabels, useRecordIdentifier, useTakenValues } from './LocalIdentifiers';
import { speciesLabel, sexLabel } from './AnimalsScreen';

export function identifierTypeLabel(
  t: (key: TranslationKey) => string,
  type: IdentifierType,
): string {
  return t(`identifier.${type}` as TranslationKey);
}

export function TagSessionScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const live = useEffectiveAnimals().filter((a) => a.status === 'alive');
  const labels = useAnimalLabels();
  const taken = useTakenValues();
  const record = useRecordIdentifier();

  // The queue is fixed when the session opens: animals that had no number then. Recomputing it
  // after every save would make the list shrink under the farmer's thumb as they work down the race.
  const [queue] = useState<readonly string[]>(() =>
    live.filter((a) => !labels.has(a.id)).map((a) => a.id),
  );
  const byId = useMemo(() => new Map(live.map((a) => [a.id, a])), [live]);

  const [index, setIndex] = useState(0);
  const [type, setType] = useState<IdentifierType>('visual_tag');
  const [value, setValue] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  if (!activeFarm) return null;

  const animalId = queue[index];
  const animal = animalId === undefined ? undefined : byId.get(animalId);

  const trimmed = value.trim();
  const isTaken = trimmed !== '' && taken.has(trimmed.toLowerCase());
  const canSave = trimmed !== '' && !isTaken;

  const advance = () => {
    setValue('');
    setIndex((i) => i + 1);
  };

  const save = () => {
    if (!animal || !canSave) return;

    record(
      schemas.newAnimalIdentifierSchema.parse({
        id: uuidv7(),
        farmId: activeFarm.id,
        animalId: animal.id,
        type,
        value: trimmed,
        // The first number an animal gets is the one it will be called by, so it is the primary.
        // A later identifier joins it rather than replacing it (FR-109).
        isPrimary: !labels.has(animal.id),
      }),
    );

    setLastSaved(trimmed);
    setSavedCount((n) => n + 1);
    advance();
  };

  const skip = () => {
    setLastSaved(null);
    advance();
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-ui text-h1 text-soil-900">{t('tag.title')}</h1>

      {lastSaved !== null && (
        <p
          role="status"
          className="mb-4 border-l-4 border-aloe-700 bg-sand-100 p-3 text-body text-soil-900"
        >
          <span className="font-data tabular-nums">{lastSaved}</span> {t('tag.saved')}
        </p>
      )}

      {queue.length === 0 ? (
        <p className="mb-6 text-body text-soil-700">{t('tag.empty')}</p>
      ) : animal ? (
        <>
          <p className="mb-1 font-data text-data-lg tabular-nums text-soil-700">
            {`${index + 1} ${t('tag.of')} ${queue.length}`}
          </p>
          <p className="mb-4 text-body text-soil-900">
            {speciesLabel(t, animal.species)}
            {' · '}
            {sexLabel(t, animal.sex)}
            {animal.breed ? ` · ${animal.breed}` : ''}
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="mb-4 flex flex-col">
              <label htmlFor="tag-type" className="mb-1 text-label uppercase text-soil-700">
                {t('tag.type')}
              </label>
              <select
                id="tag-type"
                name="tag-type"
                value={type}
                onChange={(e) => setType(e.target.value as IdentifierType)}
                className="min-h-touch-min rounded border border-soil-200 bg-sand-100 px-3 text-body text-soil-900"
              >
                {IDENTIFIER_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {identifierTypeLabel(t, option)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-6 flex flex-col">
              <label htmlFor="tag-value" className="mb-1 text-label uppercase text-soil-700">
                {t('tag.number')}
              </label>
              <input
                id="tag-value"
                name="tag-value"
                type="text"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-describedby={isTaken ? 'tag-taken' : undefined}
                className="min-h-touch-primary rounded border border-soil-200 bg-sand-100 px-3 font-data text-data-lg tabular-nums text-soil-900"
              />
              {/* A warning, not an action: tinted panel with a left rule, never the ochre form. */}
              {isTaken && (
                <p
                  id="tag-taken"
                  className="mt-1 border-l-4 border-klei-700 bg-klei-100 p-2 text-body text-soil-900"
                >
                  {t('tag.taken')}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSave}
              className="min-h-touch-primary w-full rounded bg-ochre-500 px-4 font-ui text-body font-semibold text-on-action disabled:opacity-60"
            >
              {t('tag.save')}
            </button>
          </form>

          <button
            type="button"
            onClick={skip}
            className="mt-4 min-h-touch-min w-full rounded border border-soil-200 px-4 font-ui text-body text-soil-900"
          >
            {t('tag.skip')}
          </button>
        </>
      ) : (
        <>
          <p className="mb-6 text-body text-soil-900">
            <span className="font-data text-data-lg tabular-nums">{savedCount}</span>{' '}
            {t('tag.done.count')}
          </p>
          <Link to="/animals" className="inline-block text-body text-dam-700">
            {t('tag.done.link')}
          </Link>
        </>
      )}

      <Link to="/animals" className="mt-6 block text-body text-dam-700">
        {t('tag.back')}
      </Link>
    </section>
  );
}
