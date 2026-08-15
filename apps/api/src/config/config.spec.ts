import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** A complete, valid environment. Individual tests override just the field under test. */
function validEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://werf:werf@localhost:5432/werf',
    JWT_SECRET: 'test-signing-key-that-is-long-enough-32',
    PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    POWERSYNC_JWT_PRIVATE_KEY: privateKey,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadConfig — PowerSync signing key', () => {
  it('accepts a real PEM private key', () => {
    const config = loadConfig(validEnv());
    expect(config.powerSyncJwtPrivateKey).toBe(privateKey);
  });

  it('accepts the one-line base64 form used by the local .env bootstrap', () => {
    const env = validEnv({
      POWERSYNC_JWT_PRIVATE_KEY: '',
      POWERSYNC_JWT_PRIVATE_KEY_BASE64: Buffer.from(privateKey).toString('base64'),
    });
    expect(loadConfig(env).powerSyncJwtPrivateKey).toBe(privateKey);
  });

  it('accepts the escaped-newline form emitted by the previous dev key generator', () => {
    const env = validEnv({ POWERSYNC_JWT_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') });
    expect(loadConfig(env).powerSyncJwtPrivateKey).toBe(privateKey);
  });

  it('refuses to boot with no signing key — a missing key must fail loudly, not sign nothing', () => {
    const env = validEnv();
    delete env.POWERSYNC_JWT_PRIVATE_KEY;
    expect(() => loadConfig(env)).toThrow(/powerSyncJwtPrivateKey/);
  });

  it('refuses text that is not a parseable private key', () => {
    expect(() => loadConfig(validEnv({ POWERSYNC_JWT_PRIVATE_KEY: 'not a real key' }))).toThrow(
      /must be a PEM-encoded private key/,
    );
  });

  it('defaults the kid and audience for local dev', () => {
    const config = loadConfig(validEnv());
    expect(config.powerSyncJwtKid).toBe('werf-dev-1');
    expect(config.powerSyncAudience).toBe('werf-dev');
  });

  it('defaults the PowerSync service URL to the local docker-compose port', () => {
    const config = loadConfig(validEnv());
    expect(config.powerSyncUrl).toBe('http://localhost:8080');
  });

  it('reads all four fields from their own env vars when set', () => {
    const config = loadConfig(
      validEnv({
        POWERSYNC_JWT_KID: 'custom-kid',
        POWERSYNC_AUDIENCE: 'werf-prod',
        POWERSYNC_URL: 'https://sync.example.com',
      }),
    );
    expect(config.powerSyncJwtKid).toBe('custom-kid');
    expect(config.powerSyncAudience).toBe('werf-prod');
    expect(config.powerSyncUrl).toBe('https://sync.example.com');
  });
});

describe('loadConfig — object storage (attachments, 3i)', () => {
  it('is null when unconfigured, same as smtp — a single feature dependency, not API-wide infra', () => {
    const config = loadConfig(validEnv());
    expect(config.objectStorage).toBeNull();
  });

  it('parses a complete bucket config, defaulting region and forcePathStyle', () => {
    const config = loadConfig(
      validEnv({
        OBJECT_STORAGE_BUCKET: 'werf-attachments-dev',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'werf-dev',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'werf-dev-secret',
      }),
    );
    expect(config.objectStorage).toEqual({
      bucket: 'werf-attachments-dev',
      region: 'af-south-1',
      endpoint: undefined,
      forcePathStyle: false,
      accessKeyId: 'werf-dev',
      secretAccessKey: 'werf-dev-secret',
    });
  });

  it('refuses a bucket with no credentials — a half-configured store fails loudly, not silently', () => {
    expect(() => loadConfig(validEnv({ OBJECT_STORAGE_BUCKET: 'werf-attachments-dev' }))).toThrow(
      /objectStorage/,
    );
  });

  it('reads a MinIO endpoint and path-style flag for dev/test', () => {
    const config = loadConfig(
      validEnv({
        OBJECT_STORAGE_BUCKET: 'werf-attachments-dev',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'werf-dev',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'werf-dev-secret',
        OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
        OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
      }),
    );
    expect(config.objectStorage?.endpoint).toBe('http://localhost:9000');
    expect(config.objectStorage?.forcePathStyle).toBe(true);
  });
});
