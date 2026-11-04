'use strict';
// Reads the identifiers ImmuPact prints on every PDF, so the Vault knows which on-chain
// agreement a file belongs to. Nothing is sent anywhere; this runs on the device.

const { keccak256, toUtf8Bytes } = require('ethers');

let pdfjs = null;
async function loadPdfjs() {
  // Text extraction only (no rendering, fonts or network). In Node, pdf.js runs its worker in-process.
  // pdf.js 4+ ships as an ES module only, so it is loaded with a dynamic import.
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

// The footer band (page numbers, initials strip) sits in the bottom 15 mm of each page.
const FOOTER_BAND_PT = 40;

/** All text of the PDF, plus the body text without footers. */
async function readPdfText(bytes) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  let all = '';
  let body = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += tc.items.map((it) => it.str).join(' ') + '\n';
    body += tc.items.filter((it) => (it.transform?.[5] ?? 999) >= FOOTER_BAND_PT).map((it) => it.str).join('');
  }
  const pages = doc.numPages;
  await task.destroy(); // pdf.js 4+: the loading task owns cleanup
  return { all, body, pages };
}

const HEX64 = '0x[0-9a-fA-F]{64}';

/** Identifiers printed on an ImmuPact PDF. Any of them may be missing on other PDFs. */
function parseIdentifiers(text) {
  const t = String(text || '');
  const pick = (re) => { const m = t.match(re); return m ? m[1] : null; };
  const contractId = pick(/Contract ID:\s*([0-9a-fA-F]{24})/) || pick(/[?&]ref=([0-9a-fA-F]{24})/);
  const agreementId = pick(new RegExp(`On-chain agreement ID[^:]*:\\s*(${HEX64})`));
  const contentHash = pick(new RegExp(`Content Hash:\\s*(${HEX64})`));
  const sealTx = pick(new RegExp(`Seal TX Hash:\\s*(${HEX64})`));
  const title = (() => {
    // Layout 2 (from Nov 2026): "Document title: <title>" in the certificate of completion.
    const v2 = t.match(/Document title:\s*(.{1,200}?)\s+Document version\b/);
    if (v2) return v2[1].replace(/\s+/g, ' ').trim();
    // Layout 1: printed between the "Generated: <date> GMT" line and the "Type: ... | Contract ID" line.
    const m = t.match(/Generated:[^\n]*?GMT\s+(.{1,200}?)\s+Type:\s*[A-Z_ ]+\s*\|/);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
  })();
  return { contractId, agreementId, contentHash, sealTx, title, isImmuPact: /ImmuPact/.test(t) && !!contractId };
}

/**
 * Digest of the agreement wording (whitespace removed), as defined by the ImmuPact standard.
 * Used only for the optional online "genuine wording" check. Keep in sync with ImmuPact's
 * src/lib/pdfContent.js.
 */
function wordingDigest(bodyText) {
  const s = String(bodyText || '').replace(/\s+/g, '');
  // Layout 2 (from Nov 2026): the document comes first, between the page-1 header line
  // "Verify at verify.immupact.com/?ref=<id>" and the "SIGNATURES" heading.
  if (!s.includes('CONTRACTINGPARTIES&SIGNATURES')) {
    const m = s.match(/verify\.immupact\.com\/\?ref=[0-9a-f]{24}/);
    if (!m) return null;
    const rest = s.slice(m.index + m[0].length);
    const end = rest.indexOf('SIGNATURESSignedelectronicallythroughImmuPact');
    return end >= 0 ? keccak256(toUtf8Bytes(rest.slice(0, end))) : null;
  }
  // Layout 1: parties first, then "CONTRACT CONTENT", then annexures or the audit trail.
  const parties = s.indexOf('CONTRACTINGPARTIES&SIGNATURES');
  const head = s.indexOf('CONTRACTCONTENT', parties >= 0 ? parties : 0);
  if (head < 0) return null;
  const rest = s.slice(head + 'CONTRACTCONTENT'.length);
  const ends = [rest.indexOf('IMMUTABLEANNEXURESThefollowingverifieddocuments'), rest.search(/AUDITTRAIL\d+immutablerecords?/)].filter((i) => i >= 0);
  if (!ends.length) return null;
  return keccak256(toUtf8Bytes(rest.slice(0, Math.min(...ends))));
}

/** Everything the Vault reads from a PDF in one pass. */
async function inspectPdf(bytes) {
  const { all, body, pages } = await readPdfText(bytes);
  return { pages, ...parseIdentifiers(all), wordingDigest: wordingDigest(body) };
}

module.exports = { readPdfText, parseIdentifiers, wordingDigest, inspectPdf };
