/**
 * What needs your attention (FR-009) — the captures the server refused, one by one, with what each
 * one is and why it came back, plus the captures WAITING behind one of them.
 *
 * ⭐ The second list is the ninth pass's fix and it is not a nicety. A held capture — the far half
 * of a move, a tally on a group the server has not accepted, a disposal short of head — is one the
 * server has never seen, so it is not a refusal and must not be presented as the farmer's problem.
 * But it was listed NOWHERE: `blocked` is derived from the refusal map, and the strip returned
 * early on the refusal count, so three captures stranded behind one refused move read as "1 not
 * sent". A hold nobody can see is a lost record, however faithfully the queue keeps the bytes.
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
import {
  useHeldCaptures,
  useRefusedCaptures,
  type CaptureKind,
  type RefusedCapture,
} from './Outbox';

/** What each kind of capture is called, in the farmer's words. */
const KIND_KEY: Record<CaptureKind, TranslationKey> = {
  landUnit: 'notSent.kind.landUnit',
  boundaryWalk: 'notSent.kind.boundaryWalk',
  planting: 'notSent.kind.planting',
  mob: 'notSent.kind.mob',
  tally: 'notSent.kind.tally',
  branding: 'notSent.kind.branding',
  animal: 'notSent.kind.animal',
  identifier: 'notSent.kind.identifier',
  weight: 'notSent.kind.weight',
  lifecycle: 'notSent.kind.lifecycle',
  move: 'notSent.kind.move',
  health: 'notSent.kind.health',
  breeding: 'notSent.kind.breeding',
  theft: 'notSent.kind.theft',
  rainfall: 'notSent.kind.rainfall',
  attachment: 'notSent.kind.attachment',
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
    case 'QUOTA_EXCEEDED':
      return 'notSent.why.quotaExceeded';
    default:
      // An unrecognised code says so rather than guessing. A wrong specific explanation sends a
      // farmer to fix something that was never wrong.
      return 'notSent.why.unknown';
  }
}

export function NotSentScreen() {
  const { t } = useTranslation();
  const refused = useRefusedCaptures();
  // ⭐ The captures WAITING on one of the refusals above. They were listed nowhere until the ninth
  // pass: `blocked` is derived from the refusal map, so a held capture appeared in no surface in
  // the product, and a farmer reading "1 not sent" had three more stranded with no way to learn it.
  // A hold nobody can see is a lost record, whatever the queue believes.
  const waiting = useHeldCaptures();
  // ⭐ A hold can stand ALONE. Every `guardedBy` hold chains back to a refusal, but `needsHead`
  // waits on arithmetic — the server's fold of the group is short of the head this decrease
  // spends — and that needs no refusal to exist. With nothing above it, "Waiting on one of the
  // above" is a pointer at an empty screen, so the section names itself instead.
  const waitingTitleKey: TranslationKey =
    refused.length > 0 ? 'notSent.waiting.title' : 'notSent.waiting.titleAlone';

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{t('notSent.title')}</h1>

      {refused.length === 0 && waiting.length === 0 ? (
        // Reached from the strip, so it can be open when the last one clears. Says the good news
        // plainly instead of showing an empty list that reads like a loading state.
        <p className="text-body text-soil-700">{t('notSent.empty')}</p>
      ) : (
        <>
          {/* ⛔ Both the intro and the list are gated on there BEING a refusal. A hold does not
              need one to exist — a decrease waits on head the server has not counted yet, and
              that hold stands alone. Ungated, this rendered "The server would not take these as
              they stand. Fix what it names" above an empty list, and then a section headed
              "Waiting on one of the above" with nothing above it. The tenth pass found it; it is
              the same class as every other copy defect here — sending a farmer to do work that
              does not exist is worse than saying nothing. */}
          {refused.length > 0 && (
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
          {waiting.length > 0 && (
            // A SECOND list, deliberately below the refusals and deliberately not styled as a
            // warning. Nothing here needs the farmer to do anything: these clear themselves the
            // moment the record they wait on goes up. Showing them as problems would ask for work
            // that would not help, and hiding them was how three deaths went missing in silence.
            <section className={refused.length > 0 ? 'mt-8' : undefined}>
              <h2 className="mb-2 font-ui text-h2 text-soil-900">{t(waitingTitleKey)}</h2>
              <p className="mb-4 text-body text-soil-700">
                {t(refused.length > 0 ? 'notSent.waiting.intro' : 'notSent.waiting.introAlone')}
              </p>
              <ul aria-label={t(waitingTitleKey)} className="flex list-none flex-col gap-4 p-0">
                {waiting.map((capture) => (
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
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('notSent.back')}
      </Link>
    </section>
  );
}
