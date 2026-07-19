import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest } from './auth.guard';

/**
 * The authenticated caller, as established by `AuthGuard`. Throws rather than returning
 * undefined if the guard did not run: a handler that reads an identity on an unguarded
 * route is a bug, and a silent `undefined` would turn it into a tenancy hole downstream.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new Error('CurrentUser used on a route with no AuthGuard');
    }
    return request.auth;
  },
);
