import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface Journal {
  readonly entries: readonly JournalEntry[];
}

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const metaDir = fileURLToPath(new URL('../migrations/meta/', import.meta.url));

describe('drizzle migration metadata', () => {
  it('keeps a snapshot for the latest journal entry so generate diffs from current state', () => {
    const journal = JSON.parse(readFileSync(`${metaDir}_journal.json`, 'utf8')) as Journal;
    const latest = journal.entries.at(-1);
    expect(latest).toBeDefined();
    expect(existsSync(`${migrationsDir}${latest!.tag}.sql`)).toBe(true);
    expect(existsSync(`${metaDir}${String(latest!.idx).padStart(4, '0')}_snapshot.json`)).toBe(
      true,
    );
  });

  it('keeps every journal entry paired with its immutable SQL migration', () => {
    const journal = JSON.parse(readFileSync(`${metaDir}_journal.json`, 'utf8')) as Journal;
    for (const entry of journal.entries) {
      expect(existsSync(`${migrationsDir}${entry.tag}.sql`), entry.tag).toBe(true);
    }
  });
});
