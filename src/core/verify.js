'use strict';
// Verifies a document directly against the blockchain. No ImmuPact account or server needed:
// if ImmuPact disappeared, this would still work. The only optional extra is the online
// "genuine wording" check, which asks ImmuPact's public verify API (wording digest only).

const { ethers } = require('ethers');
const { NETWORKS, DEFAULT_NETWORK, V1_ABI, V2_ABI, V2_KIND, V2_STATUS } = require('./standard');

const HEX64 = /^0x[0-9a-fA-F]{64}$/;

/** Calls `fn` with a provider for each RPC in turn until one works. */
async function withChain(network, rpcs, fn) {
  const net = NETWORKS[network] || NETWORKS[DEFAULT_NETWORK];
  const urls = rpcs && rpcs.length ? rpcs : net.rpcs;
  let lastErr;
  for (const url of urls) {
    const provider = new ethers.JsonRpcProvider(url, net.chainId, { staticNetwork: true });
    try {
      return await fn(provider, net);
    } catch (err) {
      lastErr = err;
    } finally {
      provider.destroy();
    }
  }
  const e = new Error('Could not reach the blockchain. Check your internet connection or the RPC settings.');
  e.cause = lastErr;
  throw e;
}

/**
 * Checks a file against the chain.
 * Returns a verdict object:
 *   verdict: 'anchored'        exact match with the anchored final PDF
 *            'not_anchored'    the agreement exists on-chain, but this exact file is not the anchored one
 *            'not_found'       no agreement on-chain for the identifiers in this file
 *            'unknown'         not an ImmuPact document (no identifiers found)
 */
async function verifyOnChain({ fileHash, ids, network = DEFAULT_NETWORK, rpcs }) {
  const checkedAt = new Date().toISOString();
  if (!ids || (!ids.agreementId && !ids.contractId)) {
    return { verdict: 'unknown', checkedAt, detail: 'No ImmuPact document ID was found in this file.' };
  }
  // A contract that reverts (e.g. "agreement not found") answered; only network errors retry.
  const reverted = (err) => err && (err.code === 'CALL_EXCEPTION' || /revert/i.test(String(err.message)));
  return withChain(network, rpcs, async (provider, net) => {
    if (ids.agreementId && HEX64.test(ids.agreementId)) {
      const core = new ethers.Contract(net.coreV2, V2_ABI, provider);
      let a; let partyCount;
      try {
        [a, partyCount] = await core.getAgreement(ids.agreementId);
      } catch (err) {
        if (reverted(err)) return { verdict: 'not_found', checkedAt, coreVersion: 2 };
        throw err;
      }
      if (Number(a.status) === 0) return { verdict: 'not_found', checkedAt, coreVersion: 2 };
      const live = {
        status: V2_STATUS[Number(a.status)] || 'unknown',
        signed: Number(a.signedCount),
        required: Number(partyCount),
        activeVersion: Number(a.activeVersion),
        sealedAt: Number(a.createdAt) ? new Date(Number(a.createdAt) * 1000).toISOString() : null,
      };
      const r = await core.verifyDocument(ids.agreementId, fileHash);
      const kind = V2_KIND[Number(r.kind)] || 'none';
      if (kind === 'final_document') {
        return { verdict: 'anchored', checkedAt, coreVersion: 2, version: Number(r.version), inForce: r.inForce, ...live };
      }
      // Not the anchored file. Is the content hash printed on it sealed? (Says nothing about the
      // wording of THIS copy; only the online check can confirm that.)
      let printedHashSealed = null;
      if (ids.contentHash && HEX64.test(ids.contentHash)) {
        const c = await core.verifyDocument(ids.agreementId, ids.contentHash);
        printedHashSealed = Number(c.kind) === 1;
      }
      return { verdict: 'not_anchored', checkedAt, coreVersion: 2, printedHashSealed, ...live };
    }
    // v1 agreements record the wording only, never a PDF.
    const core = new ethers.Contract(net.coreV1, V1_ABI, provider);
    let c;
    try {
      c = await core.getContract(ids.contractId);
    } catch (err) {
      if (reverted(err)) return { verdict: 'not_found', checkedAt, coreVersion: 1 };
      throw err;
    }
    if (/^0x0{64}$/.test(String(c.contentHash))) return { verdict: 'not_found', checkedAt, coreVersion: 1 };
    const live = {
      status: c.isExecuted ? 'executed' : c.isDisputed ? 'disputed' : c.isActive ? 'active' : 'pending',
      signed: Number(c.signed), required: Number(c.required),
      sealedAt: Number(c.createdAt) ? new Date(Number(c.createdAt) * 1000).toISOString() : null,
    };
    const printedHashSealed = ids.contentHash ? String(c.contentHash).toLowerCase() === ids.contentHash.toLowerCase() : null;
    return { verdict: 'not_anchored', checkedAt, coreVersion: 1, printedHashSealed, v1: true, ...live };
  });
}

/**
 * Optional online check (off unless the user turns it on in Settings). Sends ImmuPact only the
 * file fingerprint and a digest of the wording, never the file, and returns ImmuPact's verdict.
 */
async function onlineWordingCheck({ apiUrl, contractId, fileHash, wordingDigest, fetchImpl = fetch }) {
  if (!apiUrl) throw new Error('No ImmuPact verify address is set.');
  const body = { ref: contractId || undefined, fileHash };
  if (wordingDigest) body.contentDigest = wordingDigest;
  const res = await fetchImpl(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.found) throw new Error(data.error || `ImmuPact verify returned ${res.status}.`);
  if (data.matched) return { verdict: 'anchored', source: 'immupact', data };
  if (data.copy) return { verdict: 'genuine_wording', source: 'immupact', data };
  if (data.copyUnverifiable) return { verdict: 'wording_unverifiable', source: 'immupact', data };
  if (data.found === false) return { verdict: 'not_found', source: 'immupact', data };
  return { verdict: 'altered', source: 'immupact', data };
}

/** Human wording for a verdict, shared by the UI and receipts. */
function describeVerdict(v) {
  if (!v) return 'Not checked yet';
  switch (v.verdict) {
    case 'anchored': return 'Anchored file: exact match with the final PDF recorded on the blockchain';
    case 'genuine_wording': return 'Genuine wording, not the anchored file (confirmed by ImmuPact)';
    case 'wording_unverifiable': return 'Not the anchored file; wording could not be compared automatically';
    case 'not_anchored': return v.v1
      ? 'Sealed on-chain (v1 records the wording only, so a PDF cannot be an exact match)'
      : 'Not the anchored file. Run the online wording check to confirm the text';
    case 'altered': return 'Altered, or not this document';
    case 'not_found': return 'No agreement found on the blockchain for this document';
    case 'unknown': return 'Not an ImmuPact document';
    default: return 'Unknown';
  }
}

module.exports = { verifyOnChain, onlineWordingCheck, describeVerdict, withChain };
