'use strict';
// Retention rules ("self-destruct"), per document or per folder. Pure functions, no I/O.
//
// A rule is one of:
//   { mode: 'keep' }                                   keep until you delete it yourself (default)
//   { mode: 'destroy_on', date: '2032-11-03' }         destroy on a date
//   { mode: 'destroy_after', days: 2190, from: 'added' | 'sealed' }   destroy N days after a date
// A legal hold (on the document or its folder) blocks destruction while it is on.
//
// Contracts often must be kept for years (in the UK typically 6 years for simple contracts and
// 12 for deeds), so a rule that destroys sooner than the minimum period in Settings is refused
// unless the user explicitly acknowledges it.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_DAYS = 6 * 365; // six years

const MODES = ['keep', 'destroy_on', 'destroy_after'];

function normalisePolicy(p) {
  if (!p || !MODES.includes(p.mode)) return { mode: 'keep' };
  if (p.mode === 'destroy_on') return { mode: 'destroy_on', date: new Date(p.date).toISOString() };
  if (p.mode === 'destroy_after') return { mode: 'destroy_after', days: Math.max(0, Math.floor(Number(p.days) || 0)), from: p.from === 'sealed' ? 'sealed' : 'added' };
  return { mode: 'keep' };
}

/** The rule that applies to a document: its own, else its folder's, else keep. */
function effectivePolicy(doc, folders = {}) {
  const folder = doc.folder ? folders[doc.folder] : null;
  const policy = doc.policy ? normalisePolicy(doc.policy) : folder?.policy ? normalisePolicy(folder.policy) : { mode: 'keep' };
  const source = doc.policy ? 'document' : folder?.policy ? 'folder' : 'default';
  const legalHold = !!(doc.legalHold || folder?.legalHold);
  return { policy, source, legalHold };
}

/** When the rule destroys the document (ISO string), or null for keep. */
function dueDate(doc, policy) {
  if (policy.mode === 'destroy_on') return policy.date;
  if (policy.mode === 'destroy_after') {
    const base = policy.from === 'sealed' && doc.sealedAt ? doc.sealedAt : doc.addedAt;
    const t = Date.parse(base);
    return Number.isFinite(t) ? new Date(t + policy.days * DAY_MS).toISOString() : null;
  }
  return null;
}

/**
 * Checks a rule before it is saved. Throws { code: 'below_minimum' } when it would destroy a
 * document sooner than the minimum retention period and the user has not acknowledged that.
 */
function validatePolicy(policy, doc, { minDays = DEFAULT_MIN_DAYS, acknowledgeShort = false, now = Date.now() } = {}) {
  const p = normalisePolicy(policy);
  if (p.mode === 'keep') return p;
  if (p.mode === 'destroy_on' && !Number.isFinite(Date.parse(p.date))) throw Object.assign(new Error('Choose a valid date.'), { code: 'invalid' });
  const due = dueDate(doc || { addedAt: new Date(now).toISOString() }, p);
  const base = Date.parse((p.mode === 'destroy_after' && p.from === 'sealed' && doc?.sealedAt) || doc?.addedAt || new Date(now).toISOString());
  const keptDays = Math.floor((Date.parse(due) - base) / DAY_MS);
  if (minDays > 0 && keptDays < minDays && !acknowledgeShort) {
    throw Object.assign(new Error(`This rule keeps the document for about ${Math.max(0, keptDays)} days, less than your minimum of ${minDays} days. Many contracts must be kept longer. Confirm to use it anyway.`), { code: 'below_minimum', keptDays, minDays });
  }
  return p;
}

/** Documents whose rule has come due and that are not on legal hold. */
function dueForDestruction(docs, folders, now = Date.now()) {
  return docs.filter((d) => !d.destroyedAt).filter((d) => {
    const { policy, legalHold } = effectivePolicy(d, folders);
    if (legalHold) return false;
    const due = dueDate(d, policy);
    return due && Date.parse(due) <= now;
  });
}

/**
 * The plaintext schedule kept next to the encrypted files: just file IDs and due dates (no names,
 * no contents). It lets the Vault destroy a file on time even while the vault is locked.
 */
function buildSchedule(docs, folders) {
  const out = {};
  for (const d of docs) {
    if (d.destroyedAt) continue;
    const { policy, legalHold } = effectivePolicy(d, folders);
    const due = dueDate(d, policy);
    if (due && !legalHold) out[d.blobId] = due;
  }
  return out;
}

module.exports = { DEFAULT_MIN_DAYS, MODES, normalisePolicy, effectivePolicy, dueDate, validatePolicy, dueForDestruction, buildSchedule };
