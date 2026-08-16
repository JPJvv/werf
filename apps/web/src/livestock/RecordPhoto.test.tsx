/**
 * Attaching a photo in the crush, as a farmer does it (phase-checklists.md 3i(c)): open the photo
 * screen, pick or take a photo, "Save & next" — with the blob committed to OPFS (the fake, here)
 * and the metadata row committed to the local register, both with no network in the path, and both
 * still there after the phone is closed and reopened. Same shape as `WeighSession.test.tsx`: seed
 * `localStorage`, render the real `<App/>`, prove durability through the same boot path a cold
 * start uses.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';
import { getCurrentFakeBlobStore } from '../test-support/blob-store';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const ATTACHMENTS_KEY = `werf-attachments:${FARM_ID}`;

const SESSION_USER: schemas.AuthSession['user'] = {
  id: '0190f3a0-0000-7000-8000-000000000001',
  email: 'thabo@rietfontein.test',
  phone: null,
  fullName: 'Thabo Mokoena',
  locale: 'en-ZA',
  theme: 'light',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function cachedSession(): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [{ id: FARM_ID, name: 'Rietfontein', enterpriseTypes: ['beef_cattle'], role: 'owner' }],
    activeFarmId: FARM_ID,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

function seedHerd(...animals: Array<Record<string, unknown>>): void {
  window.localStorage.setItem(HERD_KEY, JSON.stringify(animals));
}

function animal(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    farmId: FARM_ID,
    species: 'cattle',
    sex: 'female',
    breed: null,
    status: 'alive',
    ...extra,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('adding a photo (phase-checklists.md 3i(c))', () => {
  it('sends the farmer to record an animal first when the herd is empty', () => {
    cachedSession();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    expect(screen.getByText(/no animals to photograph yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /record an animal/i })).toBeTruthy();
  });

  it('⭐ commits the blob and the metadata with no network in the path, and both survive a cold start', async () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/photo');
    const { unmount } = render(<App />);

    expect(await screen.findByText('1 of 2')).toBeTruthy();

    const file = new File(['fake-jpeg-bytes'], 'cow.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/photo/i), file);
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    // Advanced to the second animal — proof the capture committed.
    await waitFor(() => expect(screen.getByText('2 of 2')).toBeTruthy());

    const stored = await storedCaptures<Record<string, unknown>>(ATTACHMENTS_KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      farmId: FARM_ID,
      subjectType: 'animal',
      subjectId: 'a1',
      mimeType: 'image/jpeg',
    });
    // A real sha256 hex digest, computed at capture — not a placeholder.
    expect(String(stored[0]!['checksum'])).toMatch(/^[0-9a-f]{64}$/);
    const attachmentId = String(stored[0]!['id']);
    expect(getCurrentFakeBlobStore().has(attachmentId)).toBe(true);
    const blob = await getCurrentFakeBlobStore().get(attachmentId);
    expect(blob?.size).toBe(file.size);

    // Close the phone and open it the next morning: nothing was sent, everything is still here.
    unmount();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    await waitFor(async () => {
      expect(await storedCaptures(ATTACHMENTS_KEY)).toHaveLength(1);
    });
    expect(getCurrentFakeBlobStore().has(attachmentId)).toBe(true);
  });

  it('walks the whole herd, one animal per screen, to a photographed count', async () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    await user.upload(
      await screen.findByLabelText(/photo/i),
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
    );
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    await user.upload(
      await screen.findByLabelText(/photo/i),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    );
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    expect(await screen.findByText('photographed')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(await storedCaptures(ATTACHMENTS_KEY)).toHaveLength(2);
  });

  it('P3.16: refuses an over-size photo at the file picker — nothing queued, Save stays disabled', async () => {
    cachedSession();
    seedHerd(animal('a1'));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    expect(await screen.findByText('1 of 1')).toBeTruthy();
    // One byte over the 25MB ceiling — the exact boundary `@werf/core/schemas` enforces.
    const oversize = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'huge.jpg', {
      type: 'image/jpeg',
    });
    await user.upload(screen.getByLabelText(/photo/i), oversize);

    expect(await screen.findByText(/too big to send/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save & next/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedCaptures(ATTACHMENTS_KEY)).toHaveLength(0);
  });

  it('P3.16: refuses an image type outside the allow-list, even though it passes the picker’s own image/* filter', async () => {
    cachedSession();
    seedHerd(animal('a1'));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    expect(await screen.findByText('1 of 1')).toBeTruthy();
    // A real browser file picker filtering by `accept="image/*"` would offer this file — the
    // whitelist is narrower than the browser's own filter (jpeg/png/webp/heic/heif only).
    const unsupported = new File(['gif bytes'], 'cow.gif', { type: 'image/gif' });
    await user.upload(screen.getByLabelText(/photo/i), unsupported);

    expect(await screen.findByText(/file type can't be sent/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save & next/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedCaptures(ATTACHMENTS_KEY)).toHaveLength(0);
  });

  it('P3.16: accepts `image/jpg` — a real non-standard alias some Android WebViews report for a camera JPEG', async () => {
    // compliance-checker, 2026-08-16 (LOW): an unnormalised exact-match check would refuse this
    // exact file — a genuine evidence photo, not a malformed one — at the picker.
    cachedSession();
    seedHerd(animal('a1'));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    expect(await screen.findByText('1 of 1')).toBeTruthy();
    const file = new File(['fake-jpeg-bytes'], 'cow.jpg', { type: 'image/jpg' });
    await user.upload(screen.getByLabelText(/photo/i), file);

    expect(screen.queryByText(/file type can't be sent/i)).toBeNull();
    expect(screen.getByRole('button', { name: /save & next/i }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('P3.16: choosing a good photo after a refused one clears the error and allows Save', async () => {
    cachedSession();
    seedHerd(animal('a1'));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    const input = await screen.findByLabelText(/photo/i);
    await user.upload(input, new File(['gif bytes'], 'cow.gif', { type: 'image/gif' }));
    expect(await screen.findByText(/file type can't be sent/i)).toBeTruthy();

    await user.upload(input, new File(['a'], 'a.jpg', { type: 'image/jpeg' }));

    expect(screen.queryByText(/file type can't be sent/i)).toBeNull();
    expect(screen.getByRole('button', { name: /save & next/i }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('skips an animal without capturing anything', async () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/photo');
    render(<App />);

    expect(await screen.findByText('1 of 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /skip this one/i }));

    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(await storedCaptures(ATTACHMENTS_KEY)).toHaveLength(0);
  });
});
