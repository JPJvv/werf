import { useEffect } from 'react';
import type { CaptureStore } from '@werf/sync';

/** Close the previous capture-store instance on farm switch/unmount. */
export function useCloseCaptureStore(store: CaptureStore<unknown>): void {
  useEffect(() => () => store.close(), [store]);
}
