#!/usr/bin/env node
// Generates a FRESH dev-only RS256 keypair for the PowerSync JWT (Phase 3 slice: the
// PowerSyncBackendConnector's fetchCredentials). Never writes the private key to disk in the
// repo — it only prints it, for you to paste into your git-ignored .env. Updates
// infra/powersync/service.yaml's client_auth.jwks in place with the matching PUBLIC half, so
// the API (signs) and the self-hosted PowerSync service (verifies) always agree after a run.
//
// Run: node scripts/generate-dev-powersync-key.mjs
//
// This is dev-only. Production key custody (where the signing key lives, how it is rotated) is
// an open ADR-0011 question — see STATUS.md — not decided by this script.

import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

const servicePath = fileURLToPath(new URL('../infra/powersync/service.yaml', import.meta.url));
const service = readFileSync(servicePath, 'utf-8');

const jwksBlock =
  `  jwks:\n` +
  `    keys:\n` +
  `      - kty: '${jwk.kty}'\n` +
  `        n: '${jwk.n}'\n` +
  `        e: '${jwk.e}'\n` +
  `        alg: '${jwk.alg}'\n` +
  `        kid: '${jwk.kid}'\n`;

const updated = service.replace(/ {2}jwks:\n(?:.*\n)*?(?= {2}audience:)/, jwksBlock);
if (updated === service) {
  console.error('Could not find the jwks: block in service.yaml to replace — check it by hand.');
  process.exit(1);
}
writeFileSync(servicePath, updated);

console.log(`Updated ${servicePath} with the new public key (kid: ${KID}).`);
console.log('\nAdd this to your .env (never commit it):\n');
console.log(`POWERSYNC_JWT_PRIVATE_KEY="${privateKey.trim().replace(/\n/g, '\\n')}"`);
console.log(`POWERSYNC_JWT_KID=${KID}`);
console.log('\nRestart the powersync service so it picks up the new public key:');
console.log('  docker compose restart powersync');
