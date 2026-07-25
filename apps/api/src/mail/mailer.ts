/**
 * The outbound-mail PORT (FR-005). One narrow interface, several adapters, and no provider name
 * anywhere above this file.
 *
 * ⭐ Why a port rather than reaching for a provider SDK. Data residency is not a preference here —
 * ADR-0002 puts this deployment in af-south-1 and Supabase Cloud was ruled out over exactly this,
 * so binding the API to one mail provider before there is a reason to would repeat the mistake one
 * layer up. An SMTP relay is the one interface every provider in every region agrees on: SES in
 * af-south-1, a Postmark account, or a self-hosted relay all satisfy it with configuration rather
 * than code.
 *
 * ⭐ Sending is BEST-EFFORT and never fails the operation that triggered it. An invitation's
 * durable fact is the pending membership row, not the email: if the relay is down, the invite still
 * exists, is still pending, and can still be re-sent. Rolling the membership back because a mail
 * server hiccuped would destroy a real record to report a transient failure — and would do it
 * inside a transaction that had already written the invitee's user row.
 *
 * No SMS. `CLAUDE.md` rules SMS out as a second factor because SIM swap is industrialised in South
 * Africa; an invitation link is a credential-shaped thing arriving on the same channel, and the
 * reasoning does not stop applying because this one is not called a factor.
 */

import { Logger } from '@nestjs/common';

/** The dependency-injection token for the port. */
export const MAILER = Symbol('MAILER');

export interface OutboundMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text. Deliberately the only body: an invitation is four lines and a link, and an
   *  HTML-only email is one a text client, a screen reader and a spam filter all read worse. */
  readonly body: string;
}

export interface Mailer {
  /**
   * Attempt to send. Resolves whether or not delivery succeeded — the caller's operation must not
   * depend on it (see the note above). Implementations log their own failures.
   */
  send(message: OutboundMessage): Promise<void>;
}

/**
 * The adapter used when no relay is configured: it writes the message to the log instead of
 * sending it.
 *
 * This is what runs in development and in tests, and it is deliberately NOT silent. An invitation
 * that vanished with no trace would be indistinguishable from one that was never triggered, and
 * the first thing anyone debugging "my colleague never got the email" needs is proof the app tried.
 */
export class LoggingMailer implements Mailer {
  private readonly logger = new Logger('Mailer');

  send(message: OutboundMessage): Promise<void> {
    this.logger.log(`No mail relay configured. Would have sent to ${message.to}: ${message.body}`);
    return Promise.resolve();
  }
}
