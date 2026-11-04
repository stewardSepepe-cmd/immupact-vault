'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { keccak256, toUtf8Bytes } = require('ethers');
const { inspectPdf, parseIdentifiers } = require('../src/core/pdf');
const { fileFingerprint } = require('../src/core/standard');

const CONTRACT_ID = '6aaaaaaaaaaaaaaaaaaaaaaa';
const AGREEMENT = '0x' + '1'.repeat(64);
const CONTENT_HASH = '0x' + '2'.repeat(64);

/** A small PDF laid out like an ImmuPact export (synthetic: no real document). */
async function samplePdf(wording) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  let y = 800;
  const line = (t) => { page.drawText(t, { x: 51, y, size: 8, font }); y -= 14; };
  line('ImmuPact');
  line('Generated: Tue, 03 Nov 2026 18:09:11 GMT');
  line('Sample Letter');
  line(`Type: LETTER   |   Status: ACTIVE   |   Document version 1   |   Contract ID: ${CONTRACT_ID}`);
  line(`Content Hash: ${CONTENT_HASH}`);
  line(`On-chain agreement ID (ImmuPact Core v2): ${AGREEMENT}`);
  line('CONTRACTING PARTIES & SIGNATURES');
  line('CONTRACT CONTENT');
  for (const w of wording.split('\n')) line(w);
  line('AUDIT TRAIL');
  line('3 immutable records');
  page.drawText('Page 1 of 1', { x: 500, y: 10, size: 6, font }); // footer band: ignored
  return Buffer.from(await pdf.save());
}

test('reads ImmuPact identifiers from a PDF', async () => {
  const info = await inspectPdf(await samplePdf('Dear Sir,\nKindly assist.'));
  assert.equal(info.contractId, CONTRACT_ID);
  assert.equal(info.agreementId, AGREEMENT);
  assert.equal(info.contentHash, CONTENT_HASH);
  assert.equal(info.title, 'Sample Letter');
  assert.equal(info.isImmuPact, true);
});

test('wording digest ignores layout and footers, and changes with one word', async () => {
  const a = await inspectPdf(await samplePdf('Dear Sir,\nKindly assist.'));
  assert.equal(a.wordingDigest, keccak256(toUtf8Bytes('DearSir,Kindlyassist.')));
  const b = await inspectPdf(await samplePdf('Dear Sir,\nKindly resist.'));
  assert.notEqual(a.wordingDigest, b.wordingDigest);
});

test('file fingerprint is keccak256 of the bytes', async () => {
  const bytes = await samplePdf('x');
  assert.equal(fileFingerprint(bytes), keccak256(bytes));
});

test('non-ImmuPact text has no identifiers', () => {
  const ids = parseIdentifiers('An ordinary invoice, total 100.');
  assert.equal(ids.isImmuPact, false);
  assert.equal(ids.contractId, null);
});
