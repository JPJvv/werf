#!/usr/bin/env node
/**
 * Gives the migration-created `werf_app` role a LOCAL-DEV login. Production provisions this
 * credential through deployment secrets; migrations intentionally keep the role NOLOGIN.
 */
import pg from 'pg';

const elevatedUrl = process.env.DATABASE_ELEVATED_URL ?? 'postgres://werf:werf@localhost:5432/werf';
const appUrl = process.env.DATABASE_URL;

if (appUrl === undefined) {
  throw new Error('DATABASE_URL is required; run `pnpm setup:local` first.');
}

const parsed = new URL(appUrl);
const elevated = new URL(elevatedUrl);
const localHosts = ['localhost', '127.0.0.1'];
if (
  !localHosts.includes(parsed.hostname) ||
  !localHosts.includes(elevated.hostname) ||
  parsed.username !== 'werf_app'
) {
  throw new Error(
    'setup:local-role only provisions the local werf_app role; refusing a non-local or differently named app/elevated target.',
  );
}

const password = decodeURIComponent(parsed.password);
if (password === '') {
  throw new Error('The local DATABASE_URL must include a password for werf_app.');
}

const escapedPassword = password.replaceAll("'", "''");
const client = new pg.Client({ connectionString: elevatedUrl });
try {
  await client.connect();
  await client.query(`ALTER ROLE werf_app WITH LOGIN PASSWORD '${escapedPassword}'`);
  console.log('[@werf/db] local werf_app login provisioned ✓');
} finally {
  await client.end();
}
