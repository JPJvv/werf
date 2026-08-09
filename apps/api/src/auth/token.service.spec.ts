import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import jwt from 'jsonwebtoken';
import { APP_CONFIG } from '../db/db.module';
import { POWERSYNC_TOKEN_TTL_SECONDS } from '../config/config';
import { TokenService } from './token.service';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

async function buildTokenService(): Promise<TokenService> {
  const moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({})],
    providers: [
      TokenService,
      {
        provide: APP_CONFIG,
        useValue: {
          jwtSecret: 'test-signing-key-that-is-long-enough-32',
          powerSyncJwtPrivateKey: privateKey,
          powerSyncJwtKid: 'werf-dev-1',
          powerSyncAudience: 'werf-dev',
          powerSyncUrl: 'http://localhost:8080',
          piiEncryptionKey: randomBytes(32).toString('base64'),
        },
      },
    ],
  }).compile();
  return moduleRef.get(TokenService);
}

describe('TokenService — signPowerSyncToken', () => {
  it('mints a token the PUBLIC key can verify — a real RS256 round trip, not a shape check', async () => {
    const tokens = await buildTokenService();
    const { token } = await tokens.signPowerSyncToken('user-123');

    const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'], audience: 'werf-dev' });
    expect(claims).toMatchObject({ sub: 'user-123', aud: 'werf-dev' });
  });

  it('carries the configured kid in the header — service.yaml matches a token to a key by kid', async () => {
    const tokens = await buildTokenService();
    const { token } = await tokens.signPowerSyncToken('user-123');

    const header = jwt.decode(token, { complete: true })?.header;
    expect(header?.kid).toBe('werf-dev-1');
    expect(header?.alg).toBe('RS256');
  });

  it('carries no claim beyond sub and the standard registered ones', async () => {
    // Deliberately minimal — farm membership is resolved by the sync stream's own farm_users
    // lookup, not baked into the token (token.service.ts's own comment on this method: a
    // revoked membership must stop syncing on the next replicated write, not wait out the
    // token's lifetime). A claim creeping in here would silently defeat that.
    const tokens = await buildTokenService();
    const { token } = await tokens.signPowerSyncToken('user-123');

    const claims = jwt.decode(token) as Record<string, unknown>;
    const knownClaims = new Set(['sub', 'aud', 'iat', 'exp']);
    for (const claim of Object.keys(claims)) {
      expect(knownClaims, `unexpected claim "${claim}" in a PowerSync token`).toContain(claim);
    }
  });

  it('expires after POWERSYNC_TOKEN_TTL_SECONDS, matching the returned expiresAt', async () => {
    const tokens = await buildTokenService();
    const before = Date.now();
    const { token, expiresAt } = await tokens.signPowerSyncToken('user-123');

    const claims = jwt.decode(token) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(POWERSYNC_TOKEN_TTL_SECONDS);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + POWERSYNC_TOKEN_TTL_SECONDS * 1000);
  });

  it('refuses verification against the wrong audience — proves the audience is actually enforced', async () => {
    const tokens = await buildTokenService();
    const { token } = await tokens.signPowerSyncToken('user-123');

    expect(() =>
      jwt.verify(token, publicKey, { algorithms: ['RS256'], audience: 'some-other-service' }),
    ).toThrow();
  });
});
