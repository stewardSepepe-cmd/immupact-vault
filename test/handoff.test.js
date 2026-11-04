'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseHandoffUrl, handoffFromArgv, findHandoffFile } = require('../src/core/handoff');

const REF = '6ae9c2b337b2ee2852ff8f22';

test('accepts a well-formed link and keeps only a plain PDF file name', () => {
  assert.deepEqual(parseHandoffUrl(`immupact-vault://import?v=1&ref=${REF}&name=acme-lease_6ae9c2b3-FINAL.pdf`),
    { ref: REF, name: 'acme-lease_6ae9c2b3-FINAL.pdf' });
  assert.deepEqual(parseHandoffUrl(`immupact-vault:import?ref=${REF.toUpperCase()}`), { ref: REF, name: null });
  // Paths, hidden files and other types are dropped; the request still works by document ID.
  for (const bad of ['../../etc/passwd.pdf', '/Users/x/secret.pdf', '..\\x.pdf', '.hidden.pdf', 'notes.txt', 'a\u0000b.pdf']) {
    assert.equal(parseHandoffUrl(`immupact-vault://import?ref=${REF}&name=${encodeURIComponent(bad)}`).name, null, bad);
  }
});

test('rejects anything that is not an import with a valid document ID', () => {
  for (const bad of [
    'https://immupact.com/import?ref=' + REF,
    'immupact-vault://delete?ref=' + REF,
    'immupact-vault://import?ref=123',
    'immupact-vault://import',
    'not a url',
  ]) assert.equal(parseHandoffUrl(bad), null, bad);
  assert.equal(handoffFromArgv(['/Applications/ImmuPact Vault', '--flag']), null);
  assert.equal(handoffFromArgv(['app', `immupact-vault://import?ref=${REF}`]).ref, REF);
});

test('finds the document in the folder by its printed ID, never trusting the file name alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipv-handoff-'));
  const pdf = (id) => Buffer.from(`%PDF-1.4 Contract ID: ${id}`);
  fs.writeFileSync(path.join(dir, 'acme-lease_6ae9c2b3-FINAL.pdf'), pdf(REF));
  fs.writeFileSync(path.join(dir, 'acme-lease_6ae9c2b3.pdf'), pdf(REF)); // a later re-export
  fs.writeFileSync(path.join(dir, 'decoy_6ae9c2b3-FINAL.pdf'), pdf('ffffffffffffffffffffffff')); // same short id, other document
  fs.writeFileSync(path.join(dir, 'unrelated.pdf'), pdf(REF)); // not a candidate by name
  const inspect = async (bytes) => ({ contractId: (bytes.toString().match(/Contract ID: ([0-9a-f]{24})/) || [])[1] || null });

  const found = await findHandoffFile(dir, { ref: REF, name: null }, { inspect });
  assert.deepEqual(found.map((f) => f.name), ['acme-lease_6ae9c2b3-FINAL.pdf', 'acme-lease_6ae9c2b3.pdf']);
  assert.equal(found[0].final, true);

  // A file the user renamed is still found when ImmuPact passes its exact name.
  fs.renameSync(path.join(dir, 'acme-lease_6ae9c2b3-FINAL.pdf'), path.join(dir, 'Flat 3 lease.pdf'));
  const byName = await findHandoffFile(dir, { ref: REF, name: 'Flat 3 lease.pdf' }, { inspect });
  assert.equal(byName[0].name, 'Flat 3 lease.pdf');

  assert.deepEqual(await findHandoffFile(path.join(dir, 'missing'), { ref: REF }, { inspect }), []);
});
