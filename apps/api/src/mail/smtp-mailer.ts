/**
 * The SMTP adapter for the `Mailer` port (FR-005). The only file in the codebase that knows how a
 * message physically leaves the building.
 *
 * Configured entirely by environment (host, port, credentials, from-address), so the provider is a
 * deployment decision rather than a code one — SES in af-south-1, Postmark, or a relay on the same
 * box all work without a line changing here. That is the point of the port; see `mailer.ts`.
 */

import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Mailer, OutboundMessage } from './mailer';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  /** STARTTLS on 587 is the common case; `true` is implicit TLS on 465. */
  readonly secure: boolean;
  readonly user?: string | undefined;
  readonly password?: string | undefined;
  /** The envelope sender. Must be an address the relay is allowed to send as. */
  readonly from: string;
}

export class SmtpMailer implements Mailer {
  private readonly logger = new Logger('Mailer');
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user === undefined
        ? {}
        : { auth: { user: config.user, pass: config.password ?? '' } }),
    });
  }

  async send(message: OutboundMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
    } catch (error) {
      // Swallowed on purpose — the caller's operation must not depend on delivery (see the port).
      // Logged with the RECIPIENT but never the body: an invitation body carries a link that is
      // effectively a credential, and logs are the least controlled place it could end up.
      this.logger.error(
        `Could not send mail to ${message.to}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
