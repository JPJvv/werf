/**
 * "Needs your attention" — the residue register (FR-131), COMPLIANCE-GATED (legal-compliance.md § 3).
 *
 * ⭐ This screen is the reader two separate holes turned out to share.
 *
 * The first: `withinWithdrawal` was being stamped onto death and tally payloads by the server and
 * read by NOTHING — no screen, no report, no test. A farmer who was stopped on "Slaughtered",
 * tapped "Died" instead and carried on had that circumstance recorded in a column an auditor would
 * have needed hand-written SQL to reach. Writing a field nobody reads is the same defect as reading
 * one nobody writes.
 *
 * The second: the cross-device race, which no send-ordering can close. Device A records Monday's
 * dip; device B, which has never heard of it, tallies forty head to the abattoir on Tuesday. Both
 * captures are honest and offline. The server sees them in ARRIVAL order and the disposal may
 * legitimately land first and pass the guard. Refusing it later is the wrong answer — the truck has
 * gone, and a refusal days after the fact only loses the record — so the disposal is kept and
 * surfaced here.
 *
 * ⭐ TWO SOURCES, and the screen is honest about which is which. The server's register is
 * authoritative and is the only one that can see the other phone's dip; the device's own derivation
 * covers what this phone captured and has not sent yet, which the server cannot possibly know
 * about. Where both have a row, the server's wins — it has strictly more of the log.
 *
 * ⛔ Nothing on this screen is a reprimand and nothing here is a refusal. Most of these rows record
 * something the farmer could not have known at the time, and one of them — a death — is not a
 * food-chain event at all. A register that scolds is one people stop opening.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/LocaleProvider';
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';
import { useSentCaptures } from '../sync/Outbox';
import { useResidueRegister, type StoredResidueFlag } from './LocalResidueRegister';
import { useLocalResidueFlags, type LocalResidueFlag } from './residue';
import { useConflictReviews, useMarkConflictReviewed } from './LocalConflictReviews';
import { useAnimalLabels } from './LocalIdentifiers';

/** One row as the screen renders it, whichever source it came from. */
interface Row {
  readonly eventId: string;
  readonly occurredOn: string;
  /** The ISO instant it happened, sorted by BYTE — never `localeCompare`, like everything here. */
  readonly occurredAt: string;
  readonly what: WhatKey;
  readonly subject: 'animal' | 'group';
  readonly intoFoodChain: boolean;
  readonly clearFrom: string | null;
  /**
   * How this row is known. `late` is the cross-device discovery, `known` is the one the product
   * warned about at capture, `unsent` is this phone's own capture that has not left the device, and
   * `sent` is this phone's own capture that HAS. They owe the farmer four different sentences, so
   * they are four states and not a boolean.
   *
   * ⭐ `sent` exists because the screen used to say "Saved on this phone. Not sent yet." on every
   * locally-derived row, including ones the server had confirmed. The server legitimately omits a
   * row it judges clear — it holds strictly more of the log than this phone — so a row can be both
   * sent and absent from the register, and the screen was stating something false on a compliance
   * surface. It is read from the sent-log, which is the only thing that actually knows.
   */
  readonly known: 'late' | 'known' | 'unsent' | 'sent';
  /**
   * ⭐ Whether the disposal is STILL inside a withholding on the records held now, as opposed to
   * having been flagged when it was recorded. `residueFlagSchema` carries this and `knownAtCapture`
   * as two facts on purpose, and this screen used to drop it — so a row the server's own
   * re-derivation says is CLEAR (the longer dose was corrected away, and the register keeps it
   * because an audit trail is a fact) rendered identically to a live one, including "Meat from this
   * must not go into the food chain."
   *
   * Contradicting your own authoritative record on a compliance screen is worse than having no
   * screen. Locally-derived rows are always `true` — the device only builds a row when its own
   * derivation says so.
   */
  readonly withinWithdrawal: boolean;
}

/**
 * The translation key for what left, in the farmer's words rather than an event type. The WHOLE key
 * is returned rather than a stem the caller interpolates: a template literal is not a member of the
 * key union, so building one at the call site would need a cast — and a cast is exactly how a
 * screen ends up rendering a key that has no copy behind it.
 */
type WhatKey =
  | 'residue.type.sale'
  | 'residue.type.death'
  | 'residue.type.slaughter'
  | 'residue.type.theft'
  | 'residue.type.left';

function whatHappened(
  flag: Pick<StoredResidueFlag, 'eventType' | 'reason' | 'intoFoodChain'>,
): WhatKey {
  if (flag.eventType === 'sale') return 'residue.type.sale';
  // An individual death that went into the food chain is a slaughter; one that did not is a death.
  // The payload flag is what says which, never a word someone typed into `cause`.
  if (flag.eventType === 'death') {
    return flag.intoFoodChain ? 'residue.type.slaughter' : 'residue.type.death';
  }
  // ⛔ Every reason that can reach here is NAMED, and the fallback is neutral rather than `death`.
  // `transfer_out` joined `TALLY_DECREASES` after this switch was written and fell through a
  // `default: 'residue.type.death'` — so ordinary camp moves were announced to the farmer as forty
  // head having died. The register upstream no longer admits transfers, but the lesson is the arm
  // itself: a default that picks a NOUN will eventually pick the wrong one. "Left the herd" is true
  // of anything that can get here, including a reason nobody has written yet.
  switch (flag.reason) {
    case 'sale':
      return 'residue.type.sale';
    case 'slaughter':
      return 'residue.type.slaughter';
    case 'theft':
      return 'residue.type.theft';
    case 'death':
      return 'residue.type.death';
    default:
      return 'residue.type.left';
  }
}

export function AttentionScreen() {
  const { t } = useTranslation();
  const { activeFarm } = useAuth();
  const server = useResidueRegister();
  const local = useLocalResidueFlags();
  // The ids the server has CONFIRMED it stored. The one thing on the device that can tell a capture
  // still sitting here from one the server has and chose not to flag.
  const sent = useSentCaptures();
  const offline = useSyncStatus().status === 'offline';
  const conflicts = useConflictReviews();
  const markReviewed = useMarkConflictReviewed();
  const labels = useAnimalLabels();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState(false);

  if (!activeFarm) return null;

  const rows = new Map<string, Row>();

  // The device's own first, so a server row for the same event overwrites it below. The server has
  // strictly more of the log — including the dose recorded on the other phone — so where the two
  // disagree it is not a tie to break, it is a better answer replacing a partial one.
  const addLocal = (flag: LocalResidueFlag): void => {
    rows.set(flag.eventId, {
      eventId: flag.eventId,
      occurredOn: flag.occurredOn,
      occurredAt: flag.occurredAt,
      what: whatHappened(flag),
      subject: flag.mobId === null ? 'animal' : 'group',
      intoFoodChain: flag.intoFoodChain,
      clearFrom: flag.clearFrom,
      known: sent.has(flag.eventId) ? 'sent' : 'unsent',
      // The device builds a local row only when its own derivation says the disposal is inside a
      // withholding, so this is true by construction here.
      withinWithdrawal: true,
    });
  };
  for (const flag of local) addLocal(flag);

  for (const flag of server) {
    // A row the server has judged CLEAR is not dropped silently: it is only here at all because the
    // stored event still carries a flag whose dose has since been corrected away, and that is a fact
    // about an audit trail rather than noise.
    rows.set(flag.eventId, {
      eventId: flag.eventId,
      occurredOn: flag.occurredOn,
      occurredAt: flag.occurredAt,
      what: whatHappened(flag),
      subject: flag.mobId === null ? 'animal' : 'group',
      intoFoodChain: flag.intoFoodChain,
      clearFrom: flag.clearFrom,
      known: flag.knownAtCapture ? 'known' : 'late',
      withinWithdrawal: flag.withinWithdrawal,
    });
  }

  // Newest first: the consignment a farmer is being asked about is almost always the last one.
  //
  // ⭐ A TOTAL order — `(occurredAt, eventId)` reversed, compared by BYTE. Day-grained captures
  // stamp every event on a day with the same instant, so ties are ordinary BY CONSTRUCTION, and
  // `occurredAt` alone would leave the order of a day's rows to the insertion order of a Map.
  // `localeCompare` is not used anywhere this order matters: it is locale-dependent and the ids are
  // UUIDv7, which are time-ordered under a byte comparison and nothing else.
  const newestFirst = [...rows.values()].sort((a, b) =>
    a.occurredAt > b.occurredAt
      ? -1
      : a.occurredAt < b.occurredAt
        ? 1
        : a.eventId > b.eventId
          ? -1
          : a.eventId < b.eventId
            ? 1
            : 0,
  );

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{t('residue.title')}</h1>
      <p className="mb-6 text-body text-soil-700">{t('attention.intro')}</p>

      {/* Not an error and not styled as one. The register still opens with no signal — it says what
          is true about how fresh it is, rather than showing a spinner over a list it already has. */}
      {offline && (
        <p className="mb-6 border-l-4 border-soil-200 bg-sand-50 p-3 text-body text-soil-700">
          {t('residue.offline')}
        </p>
      )}

      {conflicts.length > 0 && (
        <section className="mb-8" aria-labelledby="conflict-review-title">
          <h2 id="conflict-review-title" className="mb-2 font-ui text-h2 text-soil-900">
            {t('conflict.title')}
          </h2>
          <p className="mb-4 text-body text-soil-700">{t('conflict.intro')}</p>
          {reviewError && (
            <p role="alert" className="mb-3 text-body text-klei-700">
              {t('conflict.error')}
            </p>
          )}
          <ul className="flex list-none flex-col gap-4 p-0">
            {conflicts.map((conflict) => {
              const kindKey =
                conflict.kind === 'field_lww'
                  ? 'conflict.move'
                  : conflict.kind === 'possible_duplicate_birth'
                    ? 'conflict.birth'
                    : 'conflict.status';
              const canReview = activeFarm.role === 'owner' || activeFarm.role === 'manager';
              return (
                <li
                  key={conflict.id}
                  className="rounded border border-soil-200 bg-sand-50 p-3 text-soil-900"
                >
                  <p className="text-body font-semibold">{t(kindKey)}</p>
                  <p className="mt-2 text-body text-soil-700">
                    {t('conflict.subject')} {labels.get(conflict.subjectId) ?? t('conflict.animal')}
                  </p>
                  {canReview ? (
                    <button
                      type="button"
                      disabled={offline || reviewing !== null}
                      onClick={() => {
                        setReviewError(false);
                        setReviewing(conflict.id);
                        void markReviewed(conflict.id)
                          .catch(() => setReviewError(true))
                          .finally(() => setReviewing(null));
                      }}
                      className="mt-3 min-h-touch-min rounded border border-dam-700 px-4 text-body text-dam-700 disabled:opacity-60"
                    >
                      {t('conflict.reviewed')}
                    </button>
                  ) : (
                    <p className="mt-2 text-body text-soil-700">{t('conflict.manager')}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {newestFirst.length > 0 && (
        <>
          <h2 className="mb-2 font-ui text-h2 text-soil-900">{t('residue.sectionTitle')}</h2>
          <p className="mb-4 text-body text-soil-700">{t('residue.intro')}</p>
        </>
      )}

      {newestFirst.length === 0 && conflicts.length === 0 && (
        <p className="text-body text-soil-700">{t('residue.empty')}</p>
      )}
      {newestFirst.length > 0 && (
        <ul aria-label={t('residue.title')} className="flex list-none flex-col gap-4 p-0">
          {newestFirst.map((row) => (
            <li
              key={row.eventId}
              className="rounded border border-soil-200 bg-sand-50 p-3 text-soil-900"
            >
              <p className="text-body">
                <span className="font-semibold">{t(row.what)}</span>
                {' · '}
                {t(row.subject === 'animal' ? 'residue.animal' : 'residue.group')}
                {' · '}
                <span className="font-data tabular-nums">{row.occurredOn}</span>
              </p>

              {/* NEVER colour alone (NFR-411). The food-chain state is a tinted panel with a left
                  rule AND the words; the not-food-chain state is plain text in the flow. Two
                  different FORMS, so sun glare on a phone screen cannot collapse them into one. */}
              {row.intoFoodChain && row.withinWithdrawal ? (
                <p className="mt-2 border-l-4 border-klei-700 bg-klei-100 p-3 text-body text-soil-900">
                  {t('residue.foodChain')}
                </p>
              ) : row.intoFoodChain ? (
                /* Flagged when it was recorded, and NOT inside a withholding on what we hold now —
                   the dose behind it was corrected away. The row stays, because the flag is a fact
                   about the audit trail; the warning does not, because it is no longer true. */
                <p className="mt-2 text-body text-soil-700">{t('residue.noLongerWithin')}</p>
              ) : (
                <p className="mt-2 text-body text-soil-700">{t('residue.notFoodChain')}</p>
              )}

              <p className="mt-2 text-body text-soil-700">
                {row.clearFrom === null ? (
                  t('residue.clearUnknown')
                ) : (
                  <>
                    {t('residue.clearFrom')}{' '}
                    <span className="font-data tabular-nums text-soil-900">{row.clearFrom}</span>
                  </>
                )}
              </p>

              <p className="mt-2 text-body text-soil-700">
                {t(
                  row.known === 'late'
                    ? 'residue.lateDiscovery'
                    : row.known === 'known'
                      ? 'residue.knownAtCapture'
                      : row.known === 'sent'
                        ? 'residue.sentNotFlagged'
                        : 'residue.notSentYet',
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Link to="/" className="mt-6 inline-block text-body text-dam-700">
        {t('residue.back')}
      </Link>
    </section>
  );
}
