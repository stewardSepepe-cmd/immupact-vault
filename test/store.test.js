'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault } = require('../src/core/store');

const FAST = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32 };
const PASS = 'a long test passphrase';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ipv-'));

test('create, add, lock, reopen, read back the exact bytes', () => {
  const dir = tmp();
  const { vault, recoveryPhrase } = Vault.create(dir, PASS, { kdf: FAST });
  assert.equal(recoveryPhrase.split(' ').length, 24);
  const bytes = Buffer.from('%PDF-1.3 pretend final pdf');
  const { doc } = vault.addDocument({ name: 'a-FINAL.pdf', bytes, inspect: { contractId: 'a'.repeat(24) } });
  assert.equal(doc.fileKey, undefined, 'file keys never leave the store');
  vault.lock();
  assert.throws(() => vault.list(), /locked/);

  // Nothing readable on disk.
  for (const f of fs.readdirSync(path.join(dir, 'blobs'))) {
    assert.equal(fs.readFileSync(path.join(dir, 'blobs', f)).includes(Buffer.from('pretend')), false);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'index.enc')).includes(Buffer.from('a-FINAL')), false);

  const again = Vault.open(dir, PASS);
  assert.deepEqual(again.readDocument(doc.id), bytes);
  assert.equal(again.addDocument({ name: 'copy.pdf', bytes }).duplicate, true);
  assert.throws(() => Vault.open(dir, 'not the passphrase'), /Wrong passphrase/);
});

test('recovery phrase reopens the vault and sets a new passphrase', () => {
  const dir = tmp();
  const { vault, recoveryPhrase } = Vault.create(dir, PASS, { kdf: FAST });
  const { doc } = vault.addDocument({ name: 'x.pdf', bytes: Buffer.from('x') });
  vault.lock();
  const rec = Vault.recover(dir, recoveryPhrase, 'a brand new passphrase');
  assert.equal(rec.readDocument(doc.id).toString(), 'x');
  rec.lock();
  assert.throws(() => Vault.open(dir, PASS), /Wrong passphrase/);
  assert.ok(Vault.open(dir, 'a brand new passphrase').isOpen);
});

test('a recovery phrase from another vault does not open this one', () => {
  const a = tmp(); const b = tmp();
  Vault.create(a, PASS, { kdf: FAST }).vault.lock();
  const other = Vault.create(b, PASS, { kdf: FAST }).recoveryPhrase;
  assert.throws(() => Vault.recover(a, other, 'a brand new passphrase'), /Decryption failed/);
});

test('destroy: file and key gone, signed receipt kept, legal hold respected', () => {
  const dir = tmp();
  const { vault } = Vault.create(dir, PASS, { kdf: FAST });
  const { doc } = vault.addDocument({ name: 'nda.pdf', bytes: Buffer.from('secret nda') });
  vault.updateDocument(doc.id, { legalHold: true });
  assert.throws(() => vault.destroyDocument(doc.id), /legal hold/);
  vault.updateDocument(doc.id, { legalHold: false });
  const receipt = vault.destroyDocument(doc.id);
  assert.ok(Vault.verifyReceipt(receipt));
  assert.equal(Vault.verifyReceipt({ ...receipt, name: 'other.pdf' }), false);
  assert.throws(() => vault.readDocument(doc.id), /destroyed/);
  assert.equal(fs.readdirSync(path.join(dir, 'blobs')).length, 0);
  assert.equal(vault.get(doc.id).fileKey, undefined);
});

test('retention: due documents are destroyed on unlock, and even while locked', () => {
  const dir = tmp();
  const { vault } = Vault.create(dir, PASS, { kdf: FAST });
  vault.setMinRetentionDays(0);
  const past = new Date(Date.now() - 1000).toISOString();
  const { doc: due } = vault.addDocument({ name: 'due.pdf', bytes: Buffer.from('due') });
  const { doc: keep } = vault.addDocument({ name: 'keep.pdf', bytes: Buffer.from('keep') });
  vault.updateDocument(due.id, { policy: { mode: 'destroy_on', date: past } });
  vault.updateDocument(keep.id, { policy: { mode: 'destroy_after', days: 3650 } });
  vault.lock();

  // Locked: only the schedule is readable, and it is enough to remove the due file.
  const removed = Vault.sweepSchedule(dir);
  assert.equal(removed.length, 1);
  const reopened = Vault.open(dir, PASS);
  const d = reopened.list().find((x) => x.id === due.id);
  assert.ok(d.destroyedAt, 'receipt written at unlock');
  assert.equal(d.receipt.reason, 'retention_rule_while_locked');
  assert.equal(reopened.readDocument(keep.id).toString(), 'keep');
});

test('folder rules apply to their documents; minimum retention guards short rules', () => {
  const dir = tmp();
  const { vault } = Vault.create(dir, PASS, { kdf: FAST });
  assert.throws(() => vault.setFolder('Short', { policy: { mode: 'destroy_after', days: 30 } }), (e) => e.code === 'below_minimum');
  vault.setFolder('Short', { policy: { mode: 'destroy_after', days: 30 } }, { acknowledgeShort: true });
  const { doc } = vault.addDocument({ name: 'f.pdf', bytes: Buffer.from('f'), folder: 'Short' });
  const listed = vault.list().find((x) => x.id === doc.id);
  assert.equal(listed.effective.source, 'folder');
  assert.ok(listed.effective.due);

  // "Keep" on the document overrides the folder's destroy rule; clearing it follows the folder again.
  vault.updateDocument(doc.id, { policy: { mode: 'keep' } });
  assert.equal(vault.list().find((x) => x.id === doc.id).effective.policy.mode, 'keep');
  vault.updateDocument(doc.id, { policy: null });
  assert.equal(vault.list().find((x) => x.id === doc.id).effective.source, 'folder');
});

test('backup copies the encrypted vault and it opens elsewhere', () => {
  const dir = tmp(); const dest = tmp();
  const { vault } = Vault.create(dir, PASS, { kdf: FAST });
  const { doc } = vault.addDocument({ name: 'b.pdf', bytes: Buffer.from('backup me') });
  const out = vault.backup(dest);
  vault.lock();
  assert.equal(Vault.open(out, PASS).readDocument(doc.id).toString(), 'backup me');
});

test('refuses short passphrases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipv-weak-'));
  assert.throws(() => Vault.create(dir, 'short', { kdf: FAST }), /at least 12 characters/);
  const { vault } = Vault.create(dir, PASS, { kdf: FAST });
  assert.throws(() => vault.changePassphrase('tooshort'), /at least 12 characters/);
});

test('rename, notes and the export log stay in the encrypted index; receipts carry both names', () => {
  const dir = tmp();
  const { vault } = Vault.create(dir, PASS, { kdf: FAST });
  const { doc } = vault.addDocument({ name: 'immupact_official_letter_6ae902c4-FINAL.pdf', bytes: Buffer.from('%PDF-1.4 a'), inspect: { title: 'Official Letter' } });
  assert.equal(doc.displayName, 'Official Letter');
  assert.throws(() => vault.updateDocument(doc.id, { name: 'other.pdf' }), /Cannot change name/);
  let d = vault.updateDocument(doc.id, { label: '  Bank letter  for mortgage ', notes: 'Original with the bank.' });
  assert.equal(d.displayName, 'Bank letter for mortgage');
  assert.equal(d.name, 'immupact_official_letter_6ae902c4-FINAL.pdf');
  d = vault.recordExport(doc.id, { kind: 'original', note: 'Sent to HMRC, case 1234', fileName: '/Users/x/Desktop/letter.pdf' });
  assert.equal(d.exports.length, 1);
  assert.equal(d.exports[0].fileName, 'letter.pdf');
  assert.throws(() => vault.recordExport(doc.id, { kind: 'email' }), /Unknown export type/);
  vault.lock();
  // Nothing readable on disk.
  const raw = fs.readFileSync(path.join(dir, 'index.enc')).toString('latin1');
  assert.ok(!raw.includes('Bank letter') && !raw.includes('HMRC'));
  const again = Vault.open(dir, PASS);
  const r = again.destroyDocument(doc.id);
  assert.equal(r.displayName, 'Bank letter for mortgage');
  assert.equal(r.name, 'immupact_official_letter_6ae902c4-FINAL.pdf');
  assert.equal(r.exportedCopies, 1);
  assert.ok(Vault.verifyReceipt(r));
});
