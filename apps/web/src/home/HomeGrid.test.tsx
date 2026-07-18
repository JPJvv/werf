import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeGrid } from './HomeGrid';

describe('HomeGrid', () => {
  it('renders each tile as a labelled door (link), not a static list', () => {
    render(<HomeGrid farmName="Klipdrif" enterpriseTypes={['vineyards']} />);
    expect(screen.getByRole('link', { name: /blocks/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /sprays/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /harvest/i })).toBeTruthy();
  });

  it('never renders an animal door for a pure-crop farm', () => {
    render(<HomeGrid farmName="Klipdrif" enterpriseTypes={['vineyards']} />);
    expect(screen.queryByRole('link', { name: /herd/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /health/i })).toBeNull();
  });

  it('names the region for assistive tech', () => {
    render(<HomeGrid farmName="Klipdrif" enterpriseTypes={['sheep']} />);
    expect(screen.getByRole('region', { name: 'Klipdrif home' })).toBeTruthy();
  });
});
