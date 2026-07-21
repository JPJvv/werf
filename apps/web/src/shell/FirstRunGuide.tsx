/**
 * Guided first run (FR-010): the two or three things worth doing before the app is useful.
 *
 * It adapts the same way the grid does — "camp" for animals, "block" for crops — because
 * the terminology is a property of what you farm, never of the screen you are on. A
 * vineyard being told to "add your first camp" is the same defect as a Sprays tile on a
 * cattle farm.
 *
 * The destinations are the module routes, which are honest placeholders until their phases
 * land. That is deliberate: this is the shape of the guide, wired to the real adaptation,
 * so Phase 2 fills the rooms rather than building the corridor.
 */

import { Link } from 'react-router-dom';
import { isCropEnterprise, isLivestockEnterprise, type EnterpriseType } from '@werf/core';
import { landTerm } from '../home/tiles';
import { useTranslation } from '../i18n/LocaleProvider';
import type { TranslationKey } from '../i18n/dictionaries';

export interface FirstRunGuideProps {
  enterpriseTypes: EnterpriseType[];
}

export function FirstRunGuide({ enterpriseTypes }: FirstRunGuideProps) {
  const { t } = useTranslation();
  const steps = firstRunSteps(enterpriseTypes);
  if (steps.length === 0) return null;

  return (
    <section aria-labelledby="first-run-title" className="mx-auto w-full max-w-5xl px-4 pb-8">
      <h2 id="first-run-title" className="mb-1 font-ui text-h2 text-soil-900">
        {t('firstRun.title')}
      </h2>
      <p className="mb-3 text-body text-soil-700">{t('firstRun.body')}</p>
      <ol className="flex list-none flex-col gap-2 p-0">
        {steps.map((step) => (
          <li key={step.labelKey}>
            <Link
              to={step.to}
              className="flex min-h-touch-min items-center rounded border border-soil-200 bg-sand-100 px-4 text-body text-soil-900 no-underline"
            >
              {t(step.labelKey)}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface FirstRunStep {
  labelKey: TranslationKey;
  to: string;
}

/**
 * Land, then stock, then people — the order a farm actually gets set up in. You cannot put
 * an animal in a camp that does not exist, so the sequence is a dependency, not a
 * preference, and it does not get personalised any more than the grid does.
 */
export function firstRunSteps(enterpriseTypes: EnterpriseType[]): FirstRunStep[] {
  const hasAnimals = enterpriseTypes.some(isLivestockEnterprise);
  const hasCrops = enterpriseTypes.some(isCropEnterprise);

  const steps: FirstRunStep[] = [];

  // The land step takes its word from `landTerm`, the same function the grid's land tile
  // uses. Re-deriving it here is what produced a mixed farm being shown a "Blocks" tile
  // and "add your first camp" immediately below it — the vocabulary fork this module is
  // supposed to prevent, in the two components most likely to be read together.
  if (hasAnimals || hasCrops) {
    steps.push({
      labelKey:
        landTerm(enterpriseTypes) === 'block' ? 'firstRun.land.crops' : 'firstRun.land.animals',
      to: '/land',
    });
  }

  // What goes ON the land is a separate question, and there the animal vocabulary does
  // win on a mixed farm: an animal is the thing a farmer captures first and most often.
  if (hasAnimals) {
    steps.push({ labelKey: 'firstRun.stock.animals', to: '/animals' });
  } else if (hasCrops) {
    steps.push({ labelKey: 'firstRun.stock.crops', to: '/harvest' });
  }

  // Every farm has people, whatever it farms.
  steps.push({ labelKey: 'firstRun.people', to: '/labour' });

  return steps;
}
