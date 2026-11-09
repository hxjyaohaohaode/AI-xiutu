import assert from 'node:assert/strict';
import { test } from 'node:test';
import { secureUuid, SecureRandomUnavailableError, type UuidCrypto } from '../src/lib/uuid.ts';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('prefers native randomUUID and keeps the Web Crypto receiver', () => {
  const expected = '12345678-1234-4abc-9def-123456789abc';
  const source: UuidCrypto = {
    randomUUID() {
      assert.equal(this, source);
      return expected;
    },
    getRandomValues() {
      assert.fail('fallback must not run when native UUID succeeds');
    },
  };
  assert.equal(secureUuid(source), expected);
});

test('HTTP-style Crypto without randomUUID uses exactly 16 random bytes', () => {
  let calls = 0;
  const source: UuidCrypto = {
    getRandomValues(bytes) {
      assert.equal(this, source);
      calls += 1;
      assert.equal(bytes.length, 16);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
      return bytes;
    },
  };
  assert.equal(secureUuid(source), '00010203-0405-4607-8809-0a0b0c0d0e0f');
  assert.equal(calls, 1);
});

test('fallback enforces v4 and RFC variant bits while preserving the remaining entropy', () => {
  for (const fill of [0x00, 0x40, 0x80, 0xff]) {
    const id = secureUuid({ getRandomValues: (bytes) => bytes.fill(fill) });
    assert.match(id, uuidV4);
    const bytes = Uint8Array.from(Buffer.from(id.replaceAll('-', ''), 'hex'));
    for (let i = 0; i < bytes.length; i += 1) {
      assert.equal(
        bytes[i],
        i === 6 ? (fill & 0x0f) | 0x40 : i === 8 ? (fill & 0x3f) | 0x80 : fill,
      );
    }
  }
});

test('a native UUID failure can fall back only to a working secure RNG', () => {
  const id = secureUuid({
    randomUUID() {
      throw new Error('native UUID blocked');
    },
    getRandomValues: (bytes) => bytes.fill(0xab),
  });
  assert.equal(id, 'abababab-abab-4bab-abab-abababababab');
});

test('no RNG is an explicit unavailable error, never a weak identifier', () => {
  for (const source of [null, {}]) {
    assert.throws(
      () => secureUuid(source),
      (error: unknown) =>
        error instanceof SecureRandomUnavailableError &&
        error.code === 'SECURE_RANDOM_UNAVAILABLE' &&
        error.message.includes('安全随机数'),
    );
  }
});

test('a failing secure RNG rejects rather than returning zero or pseudo-random bytes', () => {
  const failure = new Error('RNG unavailable');
  assert.throws(
    () =>
      secureUuid({
        getRandomValues() {
          throw failure;
        },
      }),
    (error: unknown) => error instanceof SecureRandomUnavailableError && error.cause === failure,
  );
});
