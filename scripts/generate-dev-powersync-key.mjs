#!/usr/bin/env node
// Generates a FRESH dev-only RS256 keypair for the PowerSync JWT (Phase 3 slice: the
// PowerSyncBackendConnector's fetchCredentials). The private key and public modulus both live in
// the git-ignored .env: apps/api reads the private half, while Docker injects only the public half
// into PowerSync's `!env` JWK scalar.
//
// Run: node scripts/generate-dev-powersync-key.mjs
//
// This is dev-only. Production key custody (where the signing key lives, how it is rotated) is
// an open ADR-0011 question — see STATUS.md — not decided by this script.

import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KID = 'werf-dev-1';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const jwk = createPublicKey(publicKey).export({ format: 'jwk' });
jwk.alg = 'RS256';
jwk.kid = KID;
jwk.use = 'sig';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const examplePath = fileURLToPath(new URL('../.env.example', import.meta.url));
let env = readFileSync(existsSync(envPath) ? envPath : examplePath, 'utf8');

function setValue(name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\s*$/, '')}\n${line}\n`;
}

setValue('POWERSYNC_JWT_PRIVATE_KEY', '');
setValue('POWERSYNC_JWT_PRIVATE_KEY_BASE64', Buffer.from(privateKey).toString('base64'));
setValue('PS_JWKS_N', jwk.n);
setValue('POWERSYNC_JWT_KID', KID);
writeFileSync(envPath, env, { encoding: 'utf8', mode: 0o600 });

console.log(`Rotated the ignored local PowerSync keypair in ${envPath}; no secret was printed.`);
console.log('Restart PowerSync and apps/api so both processes pick up the new pair.');
