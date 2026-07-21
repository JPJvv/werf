import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount rendered React trees after every test. Without this, DOM accumulates
// across tests in a file and getByRole/getByText fail with "multiple elements".
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia. The theme code guards its absence, but a
// stub lets "Match my phone" (system) paths run in tests. Defaults to light.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
