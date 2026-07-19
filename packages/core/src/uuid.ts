/**
 * UUIDv7 generation.
 *
 * v7, not v4, everywhere an id is stored: the first 48 bits are a millisecond timestamp,
 * so ids sort by creation time and a btree index on them stays dense instead of scattering
 * writes across the whole tree. On a table that only grows, that difference compounds.
 *
 * Client-generated, because the client is offline and cannot ask a sequence for an id
 * (`.claude/rules/db.md`). The database's `uuid_generate_v7()` is the server-side twin of
 * this function, for rows the server creates.
 */

/**
 * A new UUIDv7: 48-bit big-endian millisecond timestamp, 4-bit version, 74 bits of
 * randomness, 2-bit variant. RFC 9562 §5.7.
 *
 * Ids generated within the same millisecond are not ordered relative to each other — the
 * sub-millisecond bits are random, not a counter. That is fine for index locality, which
 * is what we want v7 for; it is NOT a sequence, and nothing should read ordering between
 * two ids as "which happened first". Use `occurred_at` for that — always.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = Date.now();
  bytes[0] = (timestamp / 2 ** 40) & 0xff;
  bytes[1] = (timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp / 2 ** 24) & 0xff;
  bytes[3] = (timestamp / 2 ** 16) & 0xff;
  bytes[4] = (timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 in the high nibble of byte 6; RFC 4122 variant (0b10) in the top bits of 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
