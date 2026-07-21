/**
 * Wires the two database connections into Nest's container. They are separate injection
 * tokens because they are separate privileges: asking for `ELEVATED_DB` is a visible act
 * in a constructor, and a reviewer scanning for "who can bypass RLS?" can grep for it.
 */

import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { createAppDb, createElevatedDb, type AppDb, type ElevatedDb } from '@werf/db';
import { loadConfig, type AppConfig } from '../config/config';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** The RLS-bound connection. Every query through it runs inside `asUser`. */
export const APP_DB = Symbol('APP_DB');

/**
 * The RLS-bypassing connection. Legitimate uses are few and all of them precede a
 * membership: registering a business, creating its first farm, and the refresh path
 * (which must find a session before it knows whose it is).
 */
export const ELEVATED_DB = Symbol('ELEVATED_DB');

/** Closes both pools on shutdown so tests and deploys don't leak connections. */
@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(APP_DB) private readonly app: AppDb,
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.app.close(), this.elevated.close()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    {
      provide: APP_DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): AppDb => createAppDb({ url: config.databaseUrl }),
    },
    {
      provide: ELEVATED_DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ElevatedDb =>
        createElevatedDb({ url: config.databaseElevatedUrl }),
    },
    DbLifecycle,
  ],
  exports: [APP_CONFIG, APP_DB, ELEVATED_DB],
})
export class DbModule {}
