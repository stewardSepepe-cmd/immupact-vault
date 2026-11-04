'use strict';
// Import pipeline: read the PDF on the device, check it on the blockchain, encrypt it into the
// vault. Kept free of Electron so it can be tested and reused (e.g. by a future CLI).

const fs = require('fs');
const path = require('path');
const { inspectPdf } = require('./pdf');
const { verifyOnChain } = require('./verify');
const { fileFingerprint } = require('./standard');

const MAX_BYTES = 50 * 1024 * 1024;

async function importFile(vault, filePath, { folder = null, network, rpcs, verify = verifyOnChain } = {}) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Not a file.');
  if (stat.size > MAX_BYTES) throw new Error('Files over 50 MB are not supported yet.');
  const bytes = fs.readFileSync(filePath);
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';

  let inspect = {};
  if (isPdf) {
    try { inspect = await inspectPdf(bytes); } catch { inspect = {}; }
  }

  let verification = null;
  try {
    verification = await verify({ fileHash: fileFingerprint(bytes), ids: inspect, network, rpcs });
  } catch (err) {
    // Offline is fine: the document is still stored, and can be checked later.
    verification = { verdict: 'unchecked', checkedAt: new Date().toISOString(), error: err.message };
  }

  return vault.addDocument({ name: path.basename(filePath), bytes, folder, inspect, verification });
}

/** Re-checks a stored document against the chain and saves the result. */
async function recheck(vault, id, { network, rpcs, verify = verifyOnChain } = {}) {
  const d = vault.get(id);
  const verification = await verify({ fileHash: d.fileHash, ids: d.ids, network, rpcs });
  const patch = { verification };
  if (verification.sealedAt && !d.sealedAt) patch.sealedAt = verification.sealedAt;
  return vault.updateDocument(id, patch);
}

module.exports = { importFile, recheck, MAX_BYTES };
