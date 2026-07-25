import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../db/db.module';
import type { AppConfig } from '../config/config';
import { LoggingMailer, MAILER, type Mailer } from './mailer';
import { SmtpMailer } from './smtp-mailer';

/**
 * Wires the `Mailer` port to an adapter chosen by CONFIGURATION, not by build.
 *
 * No relay configured → the logging adapter, which is what development and tests get. That is a
 * deliberate default rather than a failure: an API that refused to boot without a mail server would
 * make every developer configure one to work on livestock capture, and an API that silently did
 * nothing would make a missing invitation impossible to diagnose. The logging adapter says what it
 * would have sent.
 *
 * Global, because mail is a cross-cutting capability the farms module needs today and payroll and
 * compliance packs will need in their phases.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Mailer =>
        config.smtp === null ? new LoggingMailer() : new SmtpMailer(config.smtp),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
