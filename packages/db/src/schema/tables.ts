/**
 * Every table this schema defines, by its Postgres name — DERIVED from the drizzle objects, never
 * listed by hand.
 *
 * It exists so a guard elsewhere can ask "is every table accounted for?" and get an answer that
 * cannot go stale. The one that needs it is the sync tenancy suite: .claude/rules/db.md promises
 * that adding a table without classifying it BREAKS THE BUILD, and that promise was previously kept
 * by a sorted list maintained by hand — so a new table broke the build only if whoever added it also
 * remembered the guard existed, which is the dependency on memory the guard is there to remove.
 * (sync-auditor finding N3.)
 *
 * Lives in @werf/db rather than in the consumer because knowing what tables exist is this package's
 * job, and because drizzle-orm is already a dependency here and need not become one everywhere else.
 */

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as animals from './animals';
import * as attachments from './attachments';
import * as auth from './auth';
import * as branding from './branding';
import * as breeding from './breeding';
import * as core from './core';
import * as conflicts from './conflicts';
import * as events from './events';
import * as land from './land';
import * as theft from './theft';
import * as veterinary from './veterinary';

const modules = [
  animals,
  attachments,
  auth,
  branding,
  breeding,
  core,
  conflicts,
  events,
  land,
  theft,
  veterinary,
];

export const SCHEMA_TABLE_NAMES: readonly string[] = modules
  .flatMap((module) => Object.values(module))
  .filter((exported): exported is PgTable => is(exported, PgTable))
  .map(getTableName)
  .sort();
