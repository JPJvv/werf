/**
 * What needs your attention (FR-009) — the captures the server refused, one by one, with what each
 * one is and why it came back.
 *
 * This exists because the honest half of the answer was already being given and the useful half was
 * not. Once the flush stopped stranding the whole queue behind a refusal, the strip could say
 * "3 need your attention" — true, and a dead end. A farmer told that something of theirs is stuck,
 * with no way to see which capture or what is wrong with it, has been handed a worry instead of a
 * task. `.claude/rules/frontend.md`: what happened, why, what now.
 *
 * What this screen deliberately does NOT have is a delete button. The queue is never discarded by
 * the system (.claude/rules/db.md) and it is not discarded by a farmer on a bad afternoon either:
 * every one of these is work someone did, and the record stays in its append-only store whatever
 * the server thinks of it. The way a refusal clears is that the CAUSE clears — a duplicate tag is
 * re-read off the animal, a camp is created, a withdrawal period ends — and the next round accepts
 * what it refused before, on its own, with nobody pressing anything.
 *
 * The reason is translated from the server's stable error CODE, never from its message. The message
 * is written on the server in English and a farmer reading the app in Afrikaans would get a
 * half-translated screen at the exact moment they most need to understand it.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';
import { useRefusedCaptures, type CaptureKind, type RefusedCapture } from './Outbox';

/** What each kind of capture is called, in the farmer's words. */
const KIND_KEY: Record<CaptureKind, TranslationKey> = {
  landUnit: 'notSent.kind.landUnit',
  mob: 'notSent.kind.mob',
  animal: 'notSent.kind.animal',
  identifier: 'notSent.kind.identifier',
  weight: 'notSent.kind.weight',
  lifecycle: 'notSent.kind.lifecycle',
  move: 'notSent.kind.move',
  health: 'notSent.kind.health',
  theft: 'notSent.kind.theft',
  rainfall: 'notSent.kind.rainfall',
};

/**
 * Why it came back, and what to do about it.
 *
 * Keyed on the code, with ONE case sharpened by kind: a refused tag is far and away the commonest
 * refusal in the product and it has a specific, actionable answer that the generic conflict line
 * cannot give — read the number off the animal again.
 */
function reasonKey(capture: RefusedCapture): TranslationKey {
  if (capture.kind === 'identifier' && capture.code === 'CONFLICT') return 'notSent.why.tagTaken';
  switch (capture.code) {
    case 'CONFLICT':
      return 'notSent.why.conflict';
    case 'VALIDATION':
      return 'notSent.why.validation';
    case 'NOT_FOUND':
      return 'notSent.why.notFound';
    case 'TENANCY':
      return 'notSent.why.tenancy';
    default:
      // An unrecognised code says so rather than guessing. A wrong specific explanation sends a
      // farmer to fix something that was never wrong.
      return 'notSent.why.unknown';
  }
}

export function NotSentScreen() {
  const { t } = useTranslation();
  const refused = useRefusedCaptures();

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{t('notSent.title')}</h1>

      {refused.length === 0 ? (
        // Reached from the strip, so it can be open when the last one clears. Says the good news
        // plainly instead of showing an empty list that reads like a loading state.
        <p className="text-body text-soil-700">{t('notSent.empty')}</p>
      ) : (
        <>
          {/* The reassurance comes FIRST, above the list. Nothing here is lost, and a farmer
              scanning a list of problems needs to know that before they read the problems. */}
          <p className="mb-6 border-l-4 border-soil-200 bg-sand-100 p-3 text-body text-soil-900">
            {t('notSent.intro')}
          </p>
          <ul aria-label={t('notSent.title')} className="flex list-none flex-col gap-4 p-0">
            {refused.map((capture) => (
              <li
                key={capture.id}
                className="rounded border border-soil-200 bg-sand-50 p-3 text-soil-900"
              >
                <p className="text-body">
                  {t(KIND_KEY[capture.kind])}
                  {capture.detail !== null && (
                    <>
                      {' '}
                      <span className="font-data tabular-nums">{capture.detail}</span>
                    </>
                  )}
                </p>
                {/* Warning FORM — tinted panel, left rule — never the ochre action shape
                    (NFR-411). Meaning is in the words; colour only reinforces. */}
                <p className="mt-2 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                  {t(reasonKey(capture))}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('notSent.back')}
      </Link>
    </section>
  );
}
