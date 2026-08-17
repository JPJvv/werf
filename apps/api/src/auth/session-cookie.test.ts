import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { schemas } from '@werf/core';
import {
  SESSION_COOKIE_NAME,
  attachSessionCookie,
  clearSessionCookie,
  sessionTokenFrom,
} from './session-cookie';

const SESSION = {
  accessToken: 'short-lived-access',
  expiresIn: 900,
  refreshToken: 'long-lived-refresh',
  refreshExpiresAt: '2026-09-08T00:00:00.000Z',
  user: {
    id: '0198a3ef-6f20-7000-8000-000000000001',
    email: 'owner@example.test',
    phone: null,
    fullName: 'Owner',
    locale: 'en-ZA',
    theme: 'light',
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    deletedAt: null,
  },
  farms: [],
  activeFarmId: null,
  secondFactor: 'complete',
} satisfies schemas.AuthSession;

function responseDouble() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    setHeader: vi.fn(),
  } as unknown as Response;
}

describe('browser session cookie', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the refresh credential out of the JSON response and in an HttpOnly cookie', () => {
    const response = responseDouble();
    const browser = attachSessionCookie(response, SESSION);

    expect(browser).not.toHaveProperty('refreshToken');
    expect(browser).not.toHaveProperty('refreshExpiresAt');
    expect(response.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      SESSION.refreshToken,
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
    );
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('reads only the named cookie and rejects malformed encoding', () => {
    const request = {
      headers: { cookie: `theme=dark; ${SESSION_COOKIE_NAME}=long-lived-refresh; other=value` },
    } as Request;
    expect(sessionTokenFrom(request)).toBe('long-lived-refresh');

    const malformed = {
      headers: { cookie: `${SESSION_COOKIE_NAME}=%E0%A4%A` },
    } as Request;
    expect(sessionTokenFrom(malformed)).toBeNull();
  });

  it('clears the same protected cookie on logout', () => {
    const response = responseDouble();
    clearSessionCookie(response);
    expect(response.clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
    );
  });
});
