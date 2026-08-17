/**
 * Retries `attempt` on ANY failure, indefinitely, on `intervalMs` cadence — never rejects, never
 * gives up. The same indiscriminate-retry-until-success shape `sqlite-capture-store.ts`'s
 * persistence coordinator already gives `capture_records` INSERTs (P1.1: "the write queue is
 * never discarded by the system," `.claude/rules/db.md`), extracted here so `opfs-blob-store.ts`
 * can give an attachment blob the identical durability guarantee under real OPFS quota pressure —
 * a farmer's photo is never silently lost, only slower until the failure clears.
 *
 * Deliberately generic rather than OPFS-specific: `navigator.storage` does not exist under plain
 * Node, so a real open belongs in Playwright (`opfs-blob-store.ts`'s own header), which means the
 * retry LOOP itself has to be provable without the real browser API for a vitest suite to ever
 * watch it fail first. This function is that seam.
 */
export async function retryDurably<T>(attempt: () => Promise<T>, intervalMs: number): Promise<T> {
  for (;;) {
    try {
      return await attempt();
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
