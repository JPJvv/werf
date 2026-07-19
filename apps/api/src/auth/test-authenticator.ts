/**
 * A software WebAuthn authenticator, for tests only.
 *
 * WebAuthn is the one part of auth we cannot exercise with a string: the client half is a
 * hardware ceremony. The choice is between mocking `@simplewebauthn` — which would test
 * that we call a library we did not verify — or building an authenticator that really
 * generates a P-256 key, really signs the challenge, and really produces the CBOR the
 * spec asks for. This is the second. It means the passkey tests fail if our origin, RP ID,
 * challenge handling, or counter logic is wrong, which is the whole point.
 *
 * It is deliberately NOT a general WebAuthn implementation. It emits exactly the shapes
 * the ceremonies need: `fmt: "none"` attestation, ES256, no extensions.
 *
 * Never imported by `src/main.ts` — this file exists for the integration tests, and the
 * private keys it makes live for the length of one test.
 */

import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

/** COSE key type / algorithm constants (RFC 8152). Only what an ES256 key needs. */
const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;

/**
 * A minimal CBOR encoder — enough for an attestation object and a COSE key.
 *
 * Supports unsigned ints, negative ints, byte strings, text strings and maps, because
 * that is all the two structures below contain. Anything else throws rather than encoding
 * something subtly wrong that the verifier would then reject for an unrelated-looking
 * reason.
 */
function cborEncode(value: unknown): Buffer {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -value - 1);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([cborHead(2, value.length), Buffer.from(value)]);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Map) {
    // Canonical CBOR sorts map keys; the verifier does not require it here, and the two
    // maps we emit are written in the order the spec documents.
    const parts = [cborHead(5, value.size)];
    for (const [key, entry] of value) {
      parts.push(cborEncode(key), cborEncode(entry));
    }
    return Buffer.concat(parts);
  }
  throw new Error(`test authenticator cannot CBOR-encode ${typeof value}`);
}

/** The CBOR initial byte plus whatever length bytes the argument needs. */
function cborHead(majorType: number, argument: number): Buffer {
  const type = majorType << 5;
  if (argument < 24) return Buffer.from([type | argument]);
  if (argument < 0x100) return Buffer.from([type | 24, argument]);
  if (argument < 0x10000) {
    const buffer = Buffer.alloc(3);
    buffer.writeUInt8(type | 25, 0);
    buffer.writeUInt16BE(argument, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(type | 26, 0);
  buffer.writeUInt32BE(argument, 1);
  return buffer;
}

const b64url = (input: Buffer | Uint8Array): string => Buffer.from(input).toString('base64url');

/**
 * One virtual authenticator holding one credential — the shape of a phone with a
 * fingerprint sensor, which is the only form factor ADR-0007 targets.
 */
export class TestAuthenticator {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly credentialId: Buffer;
  /** Mirrors a real authenticator's monotonic use counter. 0 means "does not implement one". */
  private counter: number;

  constructor(options: { credentialId?: Buffer; counter?: number } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.credentialId = options.credentialId ?? randomBytes(32);
    this.counter = options.counter ?? 0;
  }

  /** The credential id as the wire and the library both spell it. */
  get id(): string {
    return b64url(this.credentialId);
  }

  /**
   * Answers `navigator.credentials.create()` — the registration ceremony.
   *
   * `origin` and `rpId` are parameters rather than constants so a test can present a
   * ceremony from the WRONG origin and prove the server rejects it. That check is the
   * phishing resistance; a test suite that can only produce correct input never exercises it.
   */
  register(params: { challenge: string; origin: string; rpId: string }): Record<string, unknown> {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: params.challenge,
        origin: params.origin,
        crossOrigin: false,
      }),
      'utf8',
    );

    const authData = this.authenticatorData(params.rpId, { includeCredential: true });

    const attestationObject = cborEncode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]),
    );

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  /**
   * Answers `navigator.credentials.get()` — the authentication ceremony.
   *
   * The signature covers `authenticatorData || SHA-256(clientDataJSON)`, which is what
   * binds the assertion to this exact challenge and origin. Sign anything less and a
   * captured signature would be replayable somewhere else.
   */
  authenticate(params: {
    challenge: string;
    origin: string;
    rpId: string;
    /** Advances the use counter, as a real authenticator does on each assertion. */
    incrementCounter?: boolean;
  }): Record<string, unknown> {
    if (params.incrementCounter ?? this.counter > 0) this.counter += 1;

    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: params.challenge,
        origin: params.origin,
        crossOrigin: false,
      }),
      'utf8',
    );

    const authData = this.authenticatorData(params.rpId, { includeCredential: false });
    const clientDataHash = createHash('sha256').update(clientDataJSON).digest();

    const signature = createSign('sha256')
      .update(Buffer.concat([authData, clientDataHash]))
      .sign(this.privateKey);

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: null,
      },
    };
  }

  /** Forces the counter backwards — what a cloned authenticator looks like. */
  rewindCounter(to: number): void {
    this.counter = to;
  }

  /**
   * `rpIdHash (32) | flags (1) | counter (4)`, plus the attested credential on
   * registration. The flags say user-present, user-verified, and — for registration —
   * attested-credential-data-included; a real platform authenticator sets all three
   * after a successful fingerprint.
   */
  private authenticatorData(rpId: string, options: { includeCredential: boolean }): Buffer {
    const rpIdHash = createHash('sha256').update(rpId, 'utf8').digest();

    const UP = 0x01;
    const UV = 0x04;
    const AT = 0x40;
    const flags = UP | UV | (options.includeCredential ? AT : 0);

    const header = Buffer.alloc(37);
    rpIdHash.copy(header, 0);
    header.writeUInt8(flags, 32);
    header.writeUInt32BE(this.counter, 33);

    if (!options.includeCredential) return header;

    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length, 0);

    return Buffer.concat([
      header,
      Buffer.alloc(16), // AAGUID: all zeroes, which is what `fmt: "none"` requires
      credentialIdLength,
      this.credentialId,
      this.cosePublicKey(),
    ]);
  }

  /** The P-256 public key in COSE_Key form, which is how WebAuthn carries it. */
  private cosePublicKey(): Buffer {
    // The uncompressed EC point is 0x04 || X(32) || Y(32) at the end of the SPKI DER.
    const der = this.publicKey.export({ type: 'spki', format: 'der' });
    const point = der.subarray(der.length - 65);
    if (point[0] !== 0x04) throw new Error('expected an uncompressed EC point');

    return cborEncode(
      new Map<number, unknown>([
        [1, COSE_KTY_EC2],
        [3, COSE_ALG_ES256],
        [-1, COSE_CRV_P256],
        [-2, new Uint8Array(point.subarray(1, 33))],
        [-3, new Uint8Array(point.subarray(33, 65))],
      ]),
    );
  }
}
