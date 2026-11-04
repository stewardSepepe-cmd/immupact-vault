'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core/crypto');

const FAST = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32 };

test('encrypt/decrypt round trip, bound to its purpose', () => {
  const key = C.randomKey();
  const blob = C.encrypt(key, Buffer.from('hello'), 'blob:a');
  assert.equal(C.decrypt(key, blob, 'blob:a').toString(), 'hello');
  assert.throws(() => C.decrypt(key, blob, 'blob:b'), /Decryption failed/);
  assert.throws(() => C.decrypt(C.randomKey(), blob, 'blob:a'), /Decryption failed/);
  const tampered = Buffer.from(blob); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => C.decrypt(key, tampered, 'blob:a'), /Decryption failed/);
});

test('passphrase wraps the vault key; wrong passphrase fails', () => {
  const key = C.randomKey();
  const rec = C.wrapVaultKey(key, 'correct horse battery', FAST);
  assert.deepEqual(C.unwrapVaultKey(rec, 'correct horse battery'), key);
  assert.throws(() => C.unwrapVaultKey(rec, 'wrong horse battery!'), /Wrong passphrase/);
  assert.throws(() => C.wrapVaultKey(key, 'short', FAST), /at least 12/);
});

test('recovery phrase is 24 words and restores the exact key', () => {
  const key = C.randomKey();
  const phrase = C.recoveryPhrase(key);
  assert.equal(phrase.split(' ').length, 24);
  assert.deepEqual(C.keyFromRecoveryPhrase(`  ${phrase.toUpperCase()}  `), key);
  const words = phrase.split(' ');
  [words[0], words[1]] = [words[1], words[0]];
  assert.throws(() => C.keyFromRecoveryPhrase(words.join(' ')), /not valid/);
});

test('receipts: signatures verify and detect any change', () => {
  const k = C.newSigningKey();
  const payload = { b: 2, a: 'x', nested: { z: 1, y: [1, 2] } };
  const sig = C.sign(k.privateKey, payload);
  assert.ok(C.verifySignature(k.publicKey, { nested: { y: [1, 2], z: 1 }, a: 'x', b: 2 }, sig), 'key order must not matter');
  assert.equal(C.verifySignature(k.publicKey, { ...payload, b: 3 }, sig), false);
});
