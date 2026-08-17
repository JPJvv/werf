#!/usr/bin/env node
/** Creates the ignored local environment needed by Postgres, PowerSync and apps/api. */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const examplePath = fileURLToPath(new URL('../.env.example', import.meta.url));
let contents = readFileSync(existsSync(envPath) ? envPath : examplePath, 'utf8');

function valueOf(name) {
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function setValue(name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  contents = pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.replace(/\s*$/, '')}\n${line}\n`;
}

setValue(
  'DATABASE_URL',
  valueOf('DATABASE_URL') || 'postgres://werf_app:werf_app_dev@localhost:5432/werf',
);
setValue(
  'DATABASE_ELEVATED_URL',
  valueOf('DATABASE_ELEVATED_URL') || 'postgres://werf:werf@localhost:5432/werf',
);
setValue('JWT_SECRET', valueOf('JWT_SECRET') || randomBytes(48).toString('base64url'));
setValue('PII_ENCRYPTION_KEY', valueOf('PII_ENCRYPTION_KEY') || randomBytes(32).toString('base64'));

let privatePem;
const encodedPrivate = valueOf('POWERSYNC_JWT_PRIVATE_KEY_BASE64');
const escapedPrivate = valueOf('POWERSYNC_JWT_PRIVATE_KEY');
if (encodedPrivate !== '') {
  privatePem = Buffer.from(encodedPrivate, 'base64').toString('utf8');
} else if (escapedPrivate !== '') {
  privatePem = escapedPrivate.replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
} else {
  ({ privateKey: privatePem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }));
  setValue('POWERSYNC_JWT_PRIVATE_KEY_BASE64', Buffer.from(privatePem).toString('base64'));
}

const privateKey = createPrivateKey(privatePem);
const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
if (publicJwk.n === undefined) {
  throw new Error('The generated PowerSync RSA key has no public modulus.');
}
setValue('PS_JWKS_N', publicJwk.n);

writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });
console.log(
  `[werf] local environment ready at ./${relative(root, envPath)} (secrets not printed) ✓`,
);
