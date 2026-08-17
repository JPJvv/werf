import type { Request, Response } from 'express';
import type { schemas } from '@werf/core';

/**
 * `__Host-` forbids a Domain attribute and requires Secure + Path=/, preventing a weaker
 * subdomain from planting or receiving Werf's production session cookie. Local HTTP development
 * cannot use Secure cookies, so it uses an intentionally different, unprefixed name.
 */
export const SESSION_COOKIE_NAME =
  process.env['NODE_ENV'] === 'production' ? '__Host-werf-session' : 'werf-session';

export function attachSessionCookie(
  response: Response,
  session: schemas.AuthSession,
): schemas.BrowserAuthSession {
  const expires = new Date(session.refreshExpiresAt);
  response.cookie(SESSION_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    expires,
  });
  // A response that sets or rotates a credential must never be cached by a browser, service
  // worker, CDN or shared proxy.
  response.setHeader('Cache-Control', 'no-store');

  const { refreshToken: _refreshToken, refreshExpiresAt: _refreshExpiresAt, ...browser } = session;
  return browser;
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
  });
  response.setHeader('Cache-Control', 'no-store');
}

/** Cookie parsing kept narrow so the API does not need a global body/cookie parser dependency. */
export function sessionTokenFrom(request: Request): string | null {
  const header = request.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}
