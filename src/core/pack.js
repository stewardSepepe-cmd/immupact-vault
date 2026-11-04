'use strict';
// Verification pack: a ZIP with the original, untouched file plus a proof sheet (PDF), the same
// facts as JSON, and plain-text instructions. The proof sits NEXT TO the document, never inside
// it: changing the PDF in any way (even adding a cover page) would break the exact match.

const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { NETWORKS, DEFAULT_NETWORK, STANDARD_VERSION } = require('./standard');
const { buildZip } = require('./zip');
const N = require('./naming');

const VERIFY_SITE = 'https://verify.immupact.com';

const VERDICT_TEXT = {
  anchored: 'Anchored file: an exact match with the final PDF recorded on the blockchain.',
  not_anchored: 'Not the anchored file: the agreement is on the blockchain, but this exact file is not the final PDF that was anchored.',
  not_found: 'No agreement was found on the blockchain for this document.',
  unknown: 'Not an ImmuPact document: it carries no ImmuPact document ID.',
  unchecked: 'Not checked: the blockchain could not be reached when the pack was made.',
};

/** The facts in the pack, as a plain object (also saved as proof.json). */
function buildProof({ doc, bytes, verification, network = DEFAULT_NETWORK, appVersion = '0.0.0', now = new Date() }) {
  const net = NETWORKS[network] || NETWORKS[DEFAULT_NETWORK];
  const v = verification || doc.verification || {};
  const coreVersion = v.coreVersion || (doc.ids?.agreementId ? 2 : 1);
  const contract = coreVersion === 2 ? net.coreV2 : net.coreV1;
  return {
    type: 'immupact/verification-pack',
    version: 1,
    standardVersion: STANDARD_VERSION,
    generatedAt: now.toISOString(),
    generatedBy: `ImmuPact Vault ${appVersion}`,
    document: {
      fileName: doc.name,
      sizeBytes: bytes.length,
      title: doc.ids?.title || null,
      name: doc.displayName || N.displayName(doc),
      immupactDocumentId: doc.ids?.contractId || null,
    },
    fingerprints: {
      // The value recorded on the blockchain.
      keccak256: doc.fileHash,
      // For checking that the file in this pack arrived intact with everyday tools (shasum, certutil).
      sha256: '0x' + crypto.createHash('sha256').update(bytes).digest('hex'),
    },
    blockchain: {
      network: net.name,
      chainId: net.chainId,
      contract,
      coreVersion,
      agreementId: doc.ids?.agreementId || null,
      contentHash: doc.ids?.contentHash || null,
      sealTx: doc.ids?.sealTx || null,
      sealedAt: doc.sealedAt || v.sealedAt || null,
      explorer: {
        contract: `${net.explorer}/address/${contract}`,
        sealTx: doc.ids?.sealTx ? `${net.explorer}/tx/${doc.ids.sealTx}` : null,
      },
    },
    checkAtExport: {
      verdict: v.verdict || 'unchecked',
      meaning: VERDICT_TEXT[v.verdict] || VERDICT_TEXT.unchecked,
      onChainStatus: v.status || null,
      signatures: v.required ? `${v.signed}/${v.required}` : null,
      checkedAt: v.checkedAt || null,
      note: 'Recorded by the sender\'s ImmuPact Vault when this pack was made. It is not a certificate: check the file yourself (see HOW-TO-VERIFY.txt).',
    },
  };
}

function howToText(proof) {
  const b = proof.blockchain;
  const lines = [
    'HOW TO VERIFY THIS DOCUMENT',
    '===========================',
    '',
    `File: ${proof.document.fileName}`,
    `Fingerprint recorded on the blockchain (keccak-256): ${proof.fingerprints.keccak256}`,
    '',
    'The PDF in this pack is the original file, unchanged. Its proof is its exact bytes: any edit,',
    're-save, compression, annotation or stamp changes the fingerprint. Renaming the file is fine.',
    '',
    '1. The quick way (no account needed)',
    `   Open ${VERIFY_SITE} and drop the PDF onto the page. Only fingerprints are sent, never the file.`,
    '   "Exact match" means it is the anchored file.',
    '',
    '2. The independent way (no ImmuPact software involved)',
    `   a. Calculate the keccak-256 hash of the PDF file's bytes with any tool you trust.`,
    `      It must equal ${proof.fingerprints.keccak256}`,
    `   b. On ${b.network} (chain ID ${b.chainId}), call verifyDocument(agreementId, fileHash) on`,
    `      the ImmuPact contract ${b.contract}`,
    `      with agreementId = ${b.agreementId || '(none: this document was sealed on the first ImmuPact contract)'}`,
    '      A result of kind 2 means "final document": the file is the anchored one.',
    `   Contract on the block explorer: ${b.explorer.contract}`,
    b.explorer.sealTx ? `   Sealing transaction: ${b.explorer.sealTx}` : null,
    '',
    '3. Check this copy arrived intact',
    `   The SHA-256 of the PDF should be ${proof.fingerprints.sha256.slice(2)}`,
    '   macOS / Linux:  shasum -a 256 "<file>"      Windows:  certutil -hashfile "<file>" SHA256',
    '',
    'At export the sender\'s vault recorded:',
    `   ${proof.checkAtExport.meaning}`,
    proof.checkAtExport.checkedAt ? `   Checked: ${proof.checkAtExport.checkedAt}` : null,
    '',
    `Generated ${proof.generatedAt} by ${proof.generatedBy} (open source, Apache-2.0).`,
    '',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// Standard PDF fonts only cover Western European characters.
function winAnsi(text) {
  return String(text ?? '')
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'").replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/\u00a0/g, ' ')
    .replace(/[^\x20-\x7e\xa1-\xff]/g, '?');
}

/** One-page proof sheet. */
async function proofSheetPdf(proof) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`Verification sheet - ${proof.document.fileName}`));
  pdf.setProducer(proof.generatedBy);
  pdf.setCreator(proof.generatedBy);
  const page = pdf.addPage([595.28, 841.89]);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const ink = rgb(0.1, 0.11, 0.14); const grey = rgb(0.42, 0.45, 0.5); const amber = rgb(0.85, 0.55, 0.05);
  const M = 48; const W = 595.28 - 2 * M;
  let y = 790;

  const wrap = (text, font, size, width) => {
    const words = winAnsi(text).split(/\s+/); const out = []; let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  const para = (text, { font = sans, size = 10, color = ink, gap = 4, indent = 0 } = {}) => {
    for (const l of wrap(text, font, size, W - indent)) { page.drawText(l, { x: M + indent, y, size, font, color }); y -= size + 3; }
    y -= gap;
  };
  const field = (label, value, { monoValue = false } = {}) => {
    page.drawText(winAnsi(label), { x: M, y, size: 8.5, font: bold, color: grey });
    const font = monoValue ? mono : sans; const size = monoValue ? 8.5 : 10;
    const lines = monoValue ? (String(value || '-').match(/.{1,46}/g) || ['-']) : wrap(value || '-', sans, size, W - 130);
    for (const l of lines) { page.drawText(winAnsi(l), { x: M + 130, y, size, font, color: ink }); y -= size + 4; }
    y -= 4;
  };

  page.drawRectangle({ x: 0, y: 812, width: 595.28, height: 30, color: rgb(0.04, 0.05, 0.07) });
  page.drawText('ImmuPact Vault', { x: M, y: 822, size: 11, font: bold, color: amber });
  page.drawText('Verification sheet', { x: M + 92, y: 822, size: 11, font: sans, color: rgb(0.9, 0.9, 0.92) });
  y = 780;
  para(proof.document.name, { font: bold, size: 16, gap: 2 });
  para(proof.document.fileName, { size: 9, color: grey, gap: 10 });

  const boxTop = y + 8;
  para('This sheet is not part of the signed document. It travels next to it. The PDF in this pack is the original file, unchanged: its proof is its exact bytes, recorded on the blockchain.', { size: 9.5, color: ink, gap: 6, indent: 10 });
  page.drawRectangle({ x: M, y: y + 2, width: W, height: boxTop - y - 2, borderColor: amber, borderWidth: 1 });
  y -= 10;

  field('AT EXPORT', `${proof.checkAtExport.meaning}${proof.checkAtExport.checkedAt ? ` Checked ${proof.checkAtExport.checkedAt.replace('T', ' ').slice(0, 16)} UTC by the sender's vault.` : ''}`);
  if (proof.checkAtExport.onChainStatus) field('ON-CHAIN STATUS', `${proof.checkAtExport.onChainStatus}${proof.checkAtExport.signatures ? ` - ${proof.checkAtExport.signatures} signed` : ''}`);
  if (proof.blockchain.sealedAt) field('SEALED', proof.blockchain.sealedAt.replace('T', ' ').slice(0, 16) + ' UTC');
  field('FILE FINGERPRINT', proof.fingerprints.keccak256, { monoValue: true });
  y += 4; para('keccak-256 of the file bytes: the value recorded on the blockchain.', { size: 8, color: grey, indent: 130 });
  field('SHA-256', proof.fingerprints.sha256, { monoValue: true });
  field('NETWORK', `${proof.blockchain.network}, chain ID ${proof.blockchain.chainId}`);
  field('CONTRACT', proof.blockchain.contract, { monoValue: true });
  if (proof.blockchain.agreementId) field('AGREEMENT ID', proof.blockchain.agreementId, { monoValue: true });
  if (proof.document.immupactDocumentId) field('DOCUMENT ID', proof.document.immupactDocumentId, { monoValue: true });
  if (proof.blockchain.sealTx) field('SEAL TRANSACTION', proof.blockchain.sealTx, { monoValue: true });

  y -= 6;
  para('How to check it yourself', { font: bold, size: 11, gap: 2 });
  para(`1. Quick: open ${VERIFY_SITE} and drop the PDF onto the page. Only fingerprints are sent, never the file.`, { size: 9.5 });
  para(`2. Independent: hash the PDF with keccak-256 and confirm it equals the file fingerprint above, then call verifyDocument(agreement ID, fingerprint) on the contract above. Kind 2 means the file is the anchored final document.`, { size: 9.5 });
  para('3. Intact copy: the SHA-256 of the PDF should equal the value above (shasum -a 256 on macOS/Linux, certutil -hashfile on Windows).', { size: 9.5 });
  para('Any edit, re-save, compression or stamp changes the fingerprint. Renaming the file does not.', { size: 9.5, color: grey });

  page.drawText(winAnsi(`Generated ${proof.generatedAt.replace('T', ' ').slice(0, 16)} UTC by ${proof.generatedBy} - open source (Apache-2.0). Full details in proof.json and HOW-TO-VERIFY.txt.`), { x: M, y: 30, size: 7.5, font: sans, color: grey });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

/**
 * Builds the pack. Returns { zip, fileName, proof }. The original file goes in byte for byte.
 */
async function buildPack({ doc, bytes, verification, network, appVersion, now = new Date() }) {
  const data = Buffer.from(bytes);
  const proof = buildProof({ doc, bytes: data, verification, network, appVersion, now });
  const folder = N.safeFileName(`${doc.displayName || N.displayName(doc)} - verification pack`);
  const sheet = await proofSheetPdf(proof);
  const zip = buildZip([
    { name: `${folder}/${N.safeFileName(doc.name)}`, data },
    { name: `${folder}/VERIFICATION-SHEET.pdf`, data: sheet },
    { name: `${folder}/proof.json`, data: JSON.stringify(proof, null, 2) + '\n' },
    { name: `${folder}/HOW-TO-VERIFY.txt`, data: howToText(proof) },
  ], { date: now });
  return { zip, fileName: `${folder}.zip`, proof };
}

module.exports = { buildProof, howToText, proofSheetPdf, buildPack, winAnsi };
