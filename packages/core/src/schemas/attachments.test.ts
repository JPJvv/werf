import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  newAttachmentSchema,
  normalizeAttachmentMimeType,
} from './attachments';

const ID = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e5f';
const FARM_ID = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e60';
const SUBJECT_ID = '018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e61';
const CHECKSUM = 'a'.repeat(64);
const OCCURRED_AT = '2026-08-16T08:00:00.000Z';

function body(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ID,
    farmId: FARM_ID,
    subjectType: 'animal',
    subjectId: SUBJECT_ID,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    checksum: CHECKSUM,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

describe('newAttachmentSchema — P3.16 size and MIME limits', () => {
  it('accepts an ordinary photo well under the limit', () => {
    expect(() => newAttachmentSchema.parse(body())).not.toThrow();
  });

  it('accepts a file exactly at the size ceiling', () => {
    expect(() =>
      newAttachmentSchema.parse(body({ sizeBytes: MAX_ATTACHMENT_SIZE_BYTES })),
    ).not.toThrow();
  });

  it('refuses a file one byte over the size ceiling', () => {
    expect(() =>
      newAttachmentSchema.parse(body({ sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1 })),
    ).toThrow();
  });

  it.each(ALLOWED_ATTACHMENT_MIME_TYPES)('accepts %s', (mimeType) => {
    expect(() => newAttachmentSchema.parse(body({ mimeType }))).not.toThrow();
  });

  it('refuses a MIME type not on the allowed list', () => {
    expect(() => newAttachmentSchema.parse(body({ mimeType: 'application/pdf' }))).toThrow();
  });

  it('refuses an SVG — an XSS vector this list deliberately excludes', () => {
    expect(() => newAttachmentSchema.parse(body({ mimeType: 'image/svg+xml' }))).toThrow();
  });

  // compliance-checker, 2026-08-16 (LOW): some Android WebViews report `image/jpg` — not a
  // registered IANA type — for a camera-captured JPEG. Unnormalised, this would refuse a genuine
  // evidence photo from a real low-end phone for a MIME-string quirk, not its content.
  it('accepts `image/jpg`, a real non-standard alias for `image/jpeg`, and normalizes it', () => {
    const parsed = newAttachmentSchema.parse(body({ mimeType: 'image/jpg' }));
    expect(parsed.mimeType).toBe('image/jpeg');
  });

  it('normalizeAttachmentMimeType passes an already-canonical type through unchanged', () => {
    expect(normalizeAttachmentMimeType('image/jpeg')).toBe('image/jpeg');
  });

  it('normalizeAttachmentMimeType leaves an unrecognised type unchanged — for isAllowed to refuse', () => {
    expect(normalizeAttachmentMimeType('application/pdf')).toBe('application/pdf');
  });
});
