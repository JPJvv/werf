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
import { SecondFactorEnrolmentRequiredError, StepUpRequiredError } from '@werf/core';
import { STEP_UP_AUTH_TTL_SECONDS } from '../config/config';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

/** Marks an endpoint as reachable without a session — login, register, refresh. */
export const IS_PUBLIC = 'werf:public';
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * Marks an endpoint an owner or bookkeeper may reach BEFORE enrolling a second factor.
 *
 * There are only two: enrolment itself, and logout. The default is the safe one — a route
 * added later is confined until someone deliberately opens it — and the set stays this
 * small on purpose. Every route wearing this decorator is reachable by an account that
 * FR-014 says is not yet fit to use the system, so each one is a decision, not a default.
 */
export const ALLOWS_PENDING_ENROLMENT = 'werf:allows-pending-enrolment';
export const AllowsPendingEnrolment = (): MethodDecorator =>
  SetMetadata(ALLOWS_PENDING_ENROLMENT, true);

/**
 * Marks a credential-changing endpoint that needs a fresh human authentication.
 * Refreshing the cookie does not satisfy this: the guard reads the original login time
 * that SessionService carries through the rotation family.
 */
export const REQUIRES_RECENT_AUTHENTICATION = 'werf:requires-recent-authentication';
export const RequiresRecentAuthentication = (): MethodDecorator =>
  SetMetadata(REQUIRES_RECENT_AUTHENTICATION, true);

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
    @Inject(TwoFactorService) private readonly twoFactor: TwoFactorService,
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

    const requiresRecentAuthentication = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_RECENT_AUTHENTICATION,
      [context.getHandler(), context.getClass()],
    );
    if (
      requiresRecentAuthentication &&
      session.authenticatedAt.getTime() < Date.now() - STEP_UP_AUTH_TTL_SECONDS * 1000
    ) {
      throw new StepUpRequiredError();
    }

    // 2FA is mandatory for owner and bookkeeper (FR-014). "Mandatory" has to mean the
    // server refuses to serve them, not that the client shows a nag screen — a nag is
    // enforced by the attacker's browser, which is to say not at all. So an account that
    // owes an enrolment reaches enrolment and logout, and nothing else.
    //
    // The check is here rather than at login because login CANNOT be the place: a user
    // with no factor enrolled has nothing to present, so refusing the login is a lockout
    // with no way out. They get a real session that can do exactly one useful thing.
    const allowsPendingEnrolment = this.reflector.getAllAndOverride<boolean>(
      ALLOWS_PENDING_ENROLMENT,
      [context.getHandler(), context.getClass()],
    );
    if (
      !allowsPendingEnrolment &&
      (await this.twoFactor.statusFor(session.userId)) === 'required'
    ) {
      throw new SecondFactorEnrolmentRequiredError();
    }

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
