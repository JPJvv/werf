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
 * ⚠️ That default is for development ONLY. In production an unset relay is a misconfiguration, and
 * the failure mode is silent: every invitation would be written to the application log — an email
 * address, a full name, a farm name and a credential-shaped link, in a sink that is frequently
 * offshore (POPIA s19). Nobody would notice until someone asked why no invitation ever arrived. So
 * production refuses to boot instead, which surfaces the missing variable at deploy.
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
      useFactory: (config: AppConfig): Mailer => {
        if (config.smtp !== null) return new SmtpMailer(config.smtp);
        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            'No mail relay is configured (SMTP_HOST is unset) and this is a production build. ' +
              'Invitations would be written to the application log instead of being sent. ' +
              'Configure SMTP_HOST, or run with NODE_ENV unset for local development.',
          );
        }
        return new LoggingMailer();
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
