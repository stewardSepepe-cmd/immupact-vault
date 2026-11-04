'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { keccak256, toUtf8Bytes } = require('ethers');
const { parseIdentifiers } = require('../src/core/pdf');

const AGREEMENT = '0x' + '1'.repeat(64);
const CONTENT_HASH = '0x' + '2'.repeat(64);

test('layout 2 (document first, certificate at the end): identifiers, title and wording', () => {
  const id = '6ae9c2b337b2ee2852ff8f22';
  const text = `Signed and sealed with ImmuPact Contract ID: ${id} Verify at verify.immupact.com/?ref=${id}
LETTER OF AUTHORITY I authorise Steward to act for me. SIGNATURES Signed electronically through ImmuPact. Each signature is recorded
CERTIFICATE OF COMPLETION Document title: Letter of Authority Document version: 1 Contract ID: ${id}
Content Hash: ${CONTENT_HASH} Seal TX Hash: 0x${'3'.repeat(64)} On-chain agreement ID (ImmuPact Core v2): ${AGREEMENT}`;
  const ids = parseIdentifiers(text);
  assert.equal(ids.contractId, id);
  assert.equal(ids.agreementId, AGREEMENT);
  assert.equal(ids.contentHash, CONTENT_HASH);
  assert.equal(ids.title, 'Letter of Authority');
  const { wordingDigest } = require('../src/core/pdf');
  const body = text.split('CERTIFICATE')[0];
  assert.equal(wordingDigest(body), keccak256(toUtf8Bytes('LETTER OF AUTHORITY I authorise Steward to act for me.'.replace(/\s+/g, ''))));
});
