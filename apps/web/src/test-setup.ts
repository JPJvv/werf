import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount rendered React trees after every test. Without this, DOM accumulates
// across tests in a file and getByRole/getByText fail with "multiple elements".
afterEach(() => {
  cleanup();
});
