import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  it('renders the active farm as the home heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Rietfontein' })).toBeTruthy();
  });

  it('shows the enterprise-adapted grid — a mixed farm has Herd and Blocks, never Camps', () => {
    render(<App />);
    expect(screen.getByRole('link', { name: /herd/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /blocks/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /camps/i })).toBeNull();
  });
});
