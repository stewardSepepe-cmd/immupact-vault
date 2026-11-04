'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildPack } = require('../src/core/pack');
const { readZip } = require('../src/core/zip');
const { fileFingerprint, NETWORKS } = require('../src/core/standard');

test('the pack carries the original bytes untouched, plus the proof', async () => {
  const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(3000)]);
  const doc = {
    id: 'd1', name: 'acme-lease_6ae9c2b3-FINAL.pdf', displayName: 'Acme lease (landlord copy)', fileHash: fileFingerprint(bytes),
    ids: { title: 'Acme Lease', contractId: '6ae9c2b337b2ee2852ff8f22', agreementId: '0x' + '1'.repeat(64), sealTx: '0x' + '2'.repeat(64) },
    sealedAt: '2026-11-03T11:17:29.000Z',
  };
  const verification = { verdict: 'anchored', coreVersion: 2, status: 'active', signed: 2, required: 2, checkedAt: '2026-11-04T09:00:00.000Z' };
  const { zip, fileName, proof } = await buildPack({ doc, bytes, verification, network: 'sepolia', appVersion: '0.2.0' });

  assert.equal(fileName, 'Acme lease (landlord copy) - verification pack.zip');
  const files = readZip(zip);
  const names = files.map((f) => f.name.split('/').pop());
  assert.deepEqual(names, ['acme-lease_6ae9c2b3-FINAL.pdf', 'VERIFICATION-SHEET.pdf', 'proof.json', 'HOW-TO-VERIFY.txt']);

  // The PDF inside is byte for byte the original, so it still verifies as the anchored file.
  assert.ok(files[0].data.equals(bytes));
  assert.equal(fileFingerprint(files[0].data), doc.fileHash);

  const json = JSON.parse(files[2].data.toString());
  assert.equal(json.fingerprints.keccak256, doc.fileHash);
  assert.equal(json.fingerprints.sha256, '0x' + crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(json.blockchain.contract, NETWORKS.sepolia.coreV2);
  assert.equal(json.blockchain.agreementId, doc.ids.agreementId);
  assert.equal(json.checkAtExport.verdict, 'anchored');
  assert.deepEqual(json, proof);

  assert.equal(files[1].data.subarray(0, 5).toString(), '%PDF-');
  const how = files[3].data.toString();
  assert.match(how, /verify\.immupact\.com/);
  assert.match(how, new RegExp(doc.fileHash));
});

test('a copy that is not the anchored file says so plainly', async () => {
  const bytes = Buffer.from('%PDF-1.4 not the final');
  const doc = { id: 'd2', name: 'letter.pdf', fileHash: fileFingerprint(bytes), ids: { title: 'Letter – “draft”', agreementId: '0x' + '3'.repeat(64) } };
  const { proof } = await buildPack({ doc, bytes, verification: { verdict: 'not_anchored', coreVersion: 2 } });
  assert.match(proof.checkAtExport.meaning, /^Not the anchored file/);
});
