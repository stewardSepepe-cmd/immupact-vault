'use strict';
// Key management and encryption. Uses only Node's built-in crypto plus a BIP-39 word list.
//
//   vault key      32 random bytes. Shown once as a 24-word recovery phrase (BIP-39 encoding of
//                  the key itself), so the phrase alone can always reopen the vault.
//   passphrase     unlocks day to day: scrypt(passphrase) -> key-encryption key that wraps the
//                  vault key in vault.json.
//   index key      HKDF(vault key) -> encrypts the index (names, rules, per-file keys).
//   file keys      one random AES-256 key per document, stored only inside the encrypted index.
//                  Destroying a document deletes its key ("crypto-shredding") and its file.
//
// All encryption is AES-256-GCM: [version 1 byte | IV 12 | tag 16 | ciphertext], with
// associated data binding each ciphertext to its purpose, so blobs cannot be swapped around.

const crypto = require('crypto');
const { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');

const FORMAT = 1;
const DEFAULT_KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32 };
const MIN_PASSPHRASE = 12;

function randomKey() {
  return crypto.randomBytes(32);
}

function deriveFromPassphrase(passphrase, salt, kdf = DEFAULT_KDF) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`The passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
  return crypto.scryptSync(passphrase.normalize('NFKC'), salt, kdf.keyLen, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024,
  });
}

function subKey(vaultKey, purpose) {
  return Buffer.from(crypto.hkdfSync('sha256', vaultKey, Buffer.alloc(0), Buffer.from(`immupact-vault/${purpose}`), 32));
}

function encrypt(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT]), iv, cipher.getAuthTag(), ct]);
}

function decrypt(key, blob, aad) {
  const buf = Buffer.from(blob);
  if (buf.length < 29 || buf[0] !== FORMAT) throw new Error('Unrecognised or damaged encrypted data.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  if (aad) decipher.setAAD(Buffer.from(aad));
  try {
    return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: wrong key, or the data was changed.');
  }
}

/** Wraps the vault key under a passphrase. Returns the JSON-safe record stored in vault.json. */
function wrapVaultKey(vaultKey, passphrase, kdf = DEFAULT_KDF) {
  const salt = crypto.randomBytes(16);
  const kek = deriveFromPassphrase(passphrase, salt, kdf);
  return { kdf: { ...kdf, salt: salt.toString('base64') }, wrapped: encrypt(kek, vaultKey, 'vault-key').toString('base64') };
}

function unwrapVaultKey(record, passphrase) {
  const kek = deriveFromPassphrase(passphrase, Buffer.from(record.kdf.salt, 'base64'), record.kdf);
  try {
    return decrypt(kek, Buffer.from(record.wrapped, 'base64'), 'vault-key');
  } catch {
    throw new Error('Wrong passphrase.');
  }
}

/** 24-word recovery phrase for a vault key, and back. */
function recoveryPhrase(vaultKey) {
  return entropyToMnemonic(new Uint8Array(vaultKey), wordlist);
}
function keyFromRecoveryPhrase(phrase) {
  const words = String(phrase || '').trim().toLowerCase().split(/\s+/).join(' ');
  if (!validateMnemonic(words, wordlist)) throw new Error('That recovery phrase is not valid. Check each word and the order.');
  const key = Buffer.from(mnemonicToEntropy(words, wordlist));
  if (key.length !== 32) throw new Error('A vault recovery phrase has 24 words.');
  return key;
}

/** Ed25519 key pair used to sign destruction receipts. */
function newSigningKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** Deterministic JSON (sorted keys), so a signed receipt can be re-checked byte for byte. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sign(privateKeyPem, payload) {
  return crypto.sign(null, Buffer.from(canonical(payload)), privateKeyPem).toString('base64');
}
function verifySignature(publicKeyPem, payload, signature) {
  try {
    return crypto.verify(null, Buffer.from(canonical(payload)), publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** Best-effort wipe of key material held in memory. */
function wipe(buf) {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}

module.exports = {
  DEFAULT_KDF, MIN_PASSPHRASE, randomKey, subKey, encrypt, decrypt,
  wrapVaultKey, unwrapVaultKey, recoveryPhrase, keyFromRecoveryPhrase,
  newSigningKey, canonical, sign, verifySignature, wipe,
};
