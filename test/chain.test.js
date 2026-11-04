'use strict';
// Live check against Sepolia. Skipped unless you set the values of a real anchored document:
//   IMMUPACT_TEST_AGREEMENT=0x...  IMMUPACT_TEST_FILEHASH=0x...  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyOnChain } = require('../src/core/verify');

const agreementId = process.env.IMMUPACT_TEST_AGREEMENT;
const fileHash = process.env.IMMUPACT_TEST_FILEHASH;
const skip = !(agreementId && fileHash) && 'set IMMUPACT_TEST_AGREEMENT and IMMUPACT_TEST_FILEHASH to run';

test('the anchored file verifies as an exact match', { skip, timeout: 60000 }, async () => {
  const r = await verifyOnChain({ fileHash, ids: { agreementId } });
  assert.equal(r.verdict, 'anchored');
  assert.ok(r.sealedAt);
});

test('any other file is not the anchored one', { skip, timeout: 60000 }, async () => {
  const r = await verifyOnChain({ fileHash: '0x' + 'ab'.repeat(32), ids: { agreementId } });
  assert.equal(r.verdict, 'not_anchored');
});

test('an unknown agreement is not found', { skip, timeout: 60000 }, async () => {
  const r = await verifyOnChain({ fileHash, ids: { agreementId: '0x' + 'cd'.repeat(32) } });
  assert.equal(r.verdict, 'not_found');
});
