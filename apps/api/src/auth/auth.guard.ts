/**
 * Turns a bearer access token into an identity, or refuses the request.
 *
 * The guard re-checks the SESSION on every request, not just the token's signature. A
 * 15-minute access token would otherwise outlive a logout or a reuse-detected revocation
 * by up to fifteen minutes — which is precisely the window an attacker with a stolen
 * token wants. One indexed lookup per request is a fair price for revocation that means
 * something.
 */

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/** Marks an endpoint as reachable without a session — login, register, refresh. */
export const IS_PUBLIC = 'werf:public';
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC, true);

/** Who the caller is. Attached to the request by the guard, read by `@CurrentUser()`. */
export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
  /**
   * The farm this session is pointed at — ADVISORY, never an authorisation. It is the
   * user's last choice of context, and it is not re-checked against membership here: a
   * membership revoked or expired after the switch leaves this value stale. Treat it as
   * "which farm did they mean", and always re-check the membership on the operation
   * itself (as every FarmsService method does).
   */
  readonly activeFarmId: string | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException();

    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch {
      // Expired, wrong signature, malformed — all the same answer. Distinguishing them
      // tells a caller which part of their forgery to fix.
      throw new UnauthorizedException();
    }

    const session = await this.sessions.findLive(claims.sid);
    if (!session) throw new UnauthorizedException();

    // The token says who; the session row says who too. They must agree. Without this,
    // the JWT signature is the ONLY thing standing between a forged `sub` and another
    // tenant's data — one key-handling mistake away from full impersonation, with no
    // second lock. The session is already loaded; comparing it is free.
    if (session.userId !== claims.sub) throw new UnauthorizedException();

    // The session row is the authority on the active farm, not the token: switching farms
    // (FR-004) must take effect immediately, not when the access token happens to expire.
    request.auth = {
      userId: session.userId,
      sessionId: session.id,
      activeFarmId: session.activeFarmId,
    };
    return true;
  }
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}
