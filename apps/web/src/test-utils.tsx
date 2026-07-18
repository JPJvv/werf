import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { LocaleProvider } from './i18n/LocaleProvider';

/** Render a component that reads the locale context, with a default (English) LocaleProvider. */
export function renderWithLocale(ui: ReactElement): RenderResult {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}
