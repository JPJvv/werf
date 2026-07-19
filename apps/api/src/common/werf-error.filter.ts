/**
 * Maps typed domain errors (@werf/core/errors) onto HTTP.
 *
 * The mapping is deliberately lossy in one direction: `InvalidCredentialsError` and a
 * missing account both become an identical 401 body, because a response that
 * distinguishes them is an account-enumeration oracle. The `reason` on a
 * SessionInvalidError stays in our logs and never reaches the wire for the same reason.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  SessionInvalidError,
  TenancyError,
  ValidationError,
  WerfError,
} from '@werf/core';

@Catch(WerfError)
export class WerfErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(WerfErrorFilter.name);

  catch(error: WerfError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.map(error);

    // A tenancy error means a query crossed a farm boundary. That is a security bug, not
    // a bad request, and it gets logged loudly whatever we tell the caller.
    if (error instanceof TenancyError) {
      this.logger.error(`TENANCY VIOLATION: ${error.message}`, error.stack);
    } else if (error instanceof SessionInvalidError) {
      this.logger.warn(`Session rejected (${error.reason})`);
    }

    response.status(status).json(body);
  }

  private map(error: WerfError): { status: number; body: Record<string, unknown> } {
    if (error instanceof InvalidCredentialsError) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        body: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
      };
    }
    if (error instanceof SessionInvalidError) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        // No `reason`: telling a caller their token was "reused" rather than "expired"
        // tells an attacker holding a stolen token that the real user is still active.
        body: { code: 'SESSION_INVALID', message: 'Session is no longer valid' },
      };
    }
    if (error instanceof ConflictError) {
      return {
        status: HttpStatus.CONFLICT,
        body: { code: 'CONFLICT', message: error.message },
      };
    }
    if (error instanceof NotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        body: { code: 'NOT_FOUND', message: error.message },
      };
    }
    if (error instanceof ValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { code: 'VALIDATION', message: error.message },
      };
    }
    if (error instanceof TenancyError) {
      // 404, not 403: confirming that a resource exists but belongs to someone else is
      // itself a disclosure.
      return {
        status: HttpStatus.NOT_FOUND,
        body: { code: 'NOT_FOUND', message: 'Not found' },
      };
    }

    this.logger.error(`Unmapped WerfError: ${error.code}`, error.stack);
    throw new HttpException(
      { code: 'INTERNAL', message: 'Internal server error' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
