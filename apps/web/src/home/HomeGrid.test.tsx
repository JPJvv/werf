import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { HomeGrid } from './HomeGrid';

/**
 * Tiles are router links, and their labels come from the dictionary (the terminology layer decides
 * the TERM, the dictionary holds the word), so the grid needs both contexts to render.
 */
const renderInRouter = (ui: ReactElement) =>
  render(
    <LocaleProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </LocaleProvider>,
  );

describe('HomeGrid', () => {
  it('renders each tile as a labelled door (link), not a static list', () => {
    renderInRouter(<HomeGrid farmName="Klipdrif" enterpriseTypes={['vineyards']} />);
    expect(screen.getByRole('link', { name: /blocks/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /sprays/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /harvest/i })).toBeTruthy();
  });

  it('never renders an animal door for a pure-crop farm', () => {
    renderInRouter(<HomeGrid farmName="Klipdrif" enterpriseTypes={['vineyards']} />);
    expect(screen.queryByRole('link', { name: /herd/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /health/i })).toBeNull();
  });

  it('names the region for assistive tech', () => {
    renderInRouter(<HomeGrid farmName="Klipdrif" enterpriseTypes={['sheep']} />);
    expect(screen.getByRole('region', { name: 'Klipdrif home' })).toBeTruthy();
  });
});
