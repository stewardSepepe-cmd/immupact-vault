'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault } = require('../src/core/store');
const { importFile, recheck } = require('../src/core/importer');

const FAST = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ipv-imp-'));

test('imports a file, stores the chain verdict, and keeps it when offline', async () => {
  const dir = tmp();
  const { vault } = Vault.create(dir, 'a long test passphrase', { kdf: FAST });
  const file = path.join(tmp(), 'notes.txt');
  fs.writeFileSync(file, 'plain text, not a PDF');

  const offline = async () => { throw new Error('Could not reach the blockchain.'); };
  const r = await importFile(vault, file, { verify: offline });
  assert.equal(r.duplicate, false);
  assert.equal(r.doc.verification.verdict, 'unchecked');
  assert.equal(vault.readDocument(r.doc.id).toString(), 'plain text, not a PDF');

  // Checking again later records the new verdict and the seal date.
  const online = async () => ({ verdict: 'anchored', sealedAt: '2026-11-03T11:17:29.000Z', checkedAt: new Date().toISOString() });
  const updated = await recheck(vault, r.doc.id, { verify: online });
  assert.equal(updated.verification.verdict, 'anchored');
  assert.equal(updated.sealedAt, '2026-11-03T11:17:29.000Z');

  // The same file again is recognised as a duplicate.
  assert.equal((await importFile(vault, file, { verify: online })).duplicate, true);
});
