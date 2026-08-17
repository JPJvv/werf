/**
 * One narrow writer for immutable authentication evidence.
 *
 * Callers provide controlled facts, never a request body. In particular, email addresses,
 * passwords, refresh/challenge tokens and WebAuthn credentials have no place in this shape.
 */

import { isIP } from 'node:net';
import { authAuditLog, type WerfDb, type WerfTx } from '@werf/db';
import type { Request } from 'express';

export type AuthAuditEvent = 'login' | 'logout' | 'farm_switch' | 'invitation' | 'session_reuse';
export type AuthAuditOutcome = 'success' | 'failure' | 'challenge';

export interface AuthAuditContext {
  readonly sourceIp?: string;
  readonly userAgent?: string;
}

type AuditMetadataValue = string | number | boolean | null;

export interface AuthAuditEntry extends AuthAuditContext {
  readonly event: AuthAuditEvent;
  readonly outcome: AuthAuditOutcome;
  readonly actorUserId?: string | null;
  readonly subjectUserId?: string | null;
  readonly farmId?: string | null;
  readonly sessionId?: string | null;
  readonly sessionFamilyId?: string | null;
  readonly metadata?: Readonly<Record<string, AuditMetadataValue>>;
}

/** Uses Express's resolved peer address; proxy trust remains an explicit deployment setting. */
export function authAuditContextFrom(request: Request): AuthAuditContext {
  const requestIp = request.ip;
  const sourceIp = requestIp && isIP(requestIp) !== 0 ? requestIp : undefined;
  const rawUserAgent = request.get('user-agent');
  return {
    ...(sourceIp ? { sourceIp } : {}),
    ...(rawUserAgent ? { userAgent: rawUserAgent.slice(0, 512) } : {}),
  };
}

export async function writeAuthAudit(db: WerfDb | WerfTx, entry: AuthAuditEntry): Promise<void> {
  await db.insert(authAuditLog).values({
    event: entry.event,
    outcome: entry.outcome,
    actorUserId: entry.actorUserId ?? null,
    subjectUserId: entry.subjectUserId ?? null,
    farmId: entry.farmId ?? null,
    sessionId: entry.sessionId ?? null,
    sessionFamilyId: entry.sessionFamilyId ?? null,
    sourceIp: entry.sourceIp ?? null,
    userAgent: entry.userAgent ?? null,
    metadata: entry.metadata ?? {},
  });
}
