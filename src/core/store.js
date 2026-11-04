'use strict';
// The vault on disk. Everything that could identify a document is encrypted.
//
//   <vault folder>/
//     vault.json      format version, vault ID, passphrase-wrapped vault key, receipt public key
//     index.enc       encrypted index: names, identifiers, rules, per-file keys, receipts
//     blobs/<id>.bin  one encrypted file per document
//     schedule.json   plaintext list of { file ID: destroy-by date } so files are destroyed on
//                     time even while the vault is locked (no names, no contents)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./crypto');
const R = require('./retention');
const { STANDARD_VERSION, fileFingerprint } = require('./standard');
const N = require('./naming');

const VAULT_FILE = 'vault.json';
const INDEX_FILE = 'index.enc';
const SCHEDULE_FILE = 'schedule.json';
const BLOBS = 'blobs';

// The file name and the identifiers read from the PDF never change; the label is the owner's own name.
const EDITABLE = ['label', 'folder', 'policy', 'legalHold', 'verification', 'onlineCheck', 'notes', 'sealedAt'];
const MAX_NOTES = 2000;
const MAX_EXPORTS = 500;

const MIN_PASSPHRASE = 12;
function assertPassphrase(p) {
  if (typeof p !== 'string' || [...p].length < MIN_PASSPHRASE) {
    throw Object.assign(new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters. A few unrelated words work well.`), { code: 'weak_passphrase' });
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function publicDoc(d) {
  // Never hand per-file keys to the UI.
  const { fileKey, ...rest } = d;
  return { ...rest, displayName: N.displayName(d) };
}

class Vault {
  constructor(dir, meta, vaultKey, index) {
    this.dir = dir;
    this.meta = meta;
    this._key = vaultKey;
    this._indexKey = C.subKey(vaultKey, 'index');
    this.index = index;
  }

  // ───────────────────────────── opening and closing

  static exists(dir) {
    return fs.existsSync(path.join(dir, VAULT_FILE));
  }

  /** Creates a new vault. Returns { vault, recoveryPhrase }; show the phrase once, never store it. */
  static create(dir, passphrase, { kdf } = {}) {
    if (Vault.exists(dir)) throw new Error('There is already a vault in that folder.');
    assertPassphrase(passphrase);
    fs.mkdirSync(path.join(dir, BLOBS), { recursive: true, mode: 0o700 });
    const vaultKey = C.randomKey();
    const signing = C.newSigningKey();
    const meta = {
      format: 1,
      standard: STANDARD_VERSION,
      id: newId(),
      createdAt: new Date().toISOString(),
      key: C.wrapVaultKey(vaultKey, passphrase, kdf),
      receiptPublicKey: signing.publicKey,
    };
    writeAtomic(path.join(dir, VAULT_FILE), JSON.stringify(meta, null, 2));
    const vault = new Vault(dir, meta, vaultKey, {
      docs: [], folders: {}, receipts: [], signingKey: signing.privateKey,
      settings: { minRetentionDays: R.DEFAULT_MIN_DAYS },
    });
    vault._save();
    return { vault, recoveryPhrase: C.recoveryPhrase(vaultKey) };
  }

  static _readMeta(dir) {
    if (!Vault.exists(dir)) throw new Error('No vault in that folder.');
    return JSON.parse(fs.readFileSync(path.join(dir, VAULT_FILE), 'utf8'));
  }

  static _load(dir, meta, vaultKey) {
    const indexKey = C.subKey(vaultKey, 'index');
    const raw = C.decrypt(indexKey, fs.readFileSync(path.join(dir, INDEX_FILE)), `index:${meta.id}`);
    const vault = new Vault(dir, meta, vaultKey, JSON.parse(raw.toString('utf8')));
    vault._reconcileLockedDestructions();
    return vault;
  }

  static open(dir, passphrase) {
    const meta = Vault._readMeta(dir);
    return Vault._load(dir, meta, C.unwrapVaultKey(meta.key, passphrase));
  }

  /** Opens the vault with the 24-word recovery phrase and sets a new passphrase. */
  static recover(dir, phrase, newPassphrase) {
    assertPassphrase(newPassphrase);
    const meta = Vault._readMeta(dir);
    const vaultKey = C.keyFromRecoveryPhrase(phrase);
    const vault = Vault._load(dir, meta, vaultKey); // throws if the phrase is for another vault
    vault.changePassphrase(newPassphrase);
    return vault;
  }

  changePassphrase(newPassphrase) {
    this._assertOpen();
    assertPassphrase(newPassphrase);
    this.meta.key = C.wrapVaultKey(this._key, newPassphrase, this.meta.key.kdf);
    writeAtomic(path.join(this.dir, VAULT_FILE), JSON.stringify(this.meta, null, 2));
  }

  lock() {
    C.wipe(this._key);
    C.wipe(this._indexKey);
    this._key = null;
    this._indexKey = null;
    this.index = null;
  }

  get isOpen() {
    return !!this._key;
  }

  _assertOpen() {
    if (!this._key) throw new Error('The vault is locked.');
  }

  _save() {
    this._assertOpen();
    const blob = C.encrypt(this._indexKey, Buffer.from(JSON.stringify(this.index)), `index:${this.meta.id}`);
    writeAtomic(path.join(this.dir, INDEX_FILE), blob);
    writeAtomic(path.join(this.dir, SCHEDULE_FILE), JSON.stringify(R.buildSchedule(this.index.docs, this.index.folders), null, 2));
  }

  _blobPath(blobId) {
    if (!/^[0-9a-f]{24}$/.test(blobId)) throw new Error('Bad file ID.');
    return path.join(this.dir, BLOBS, `${blobId}.bin`);
  }

  // ───────────────────────────── documents

  list() {
    this._assertOpen();
    return this.index.docs.map((d) => {
      const eff = R.effectivePolicy(d, this.index.folders);
      return { ...publicDoc(d), effective: { ...eff, due: R.dueDate(d, eff.policy) } };
    });
  }

  get(id) {
    this._assertOpen();
    const d = this.index.docs.find((x) => x.id === id);
    if (!d) throw new Error('Document not found.');
    return d;
  }

  /**
   * Adds a document. `inspect` holds identifiers read from the PDF; `verification` is the on-chain
   * verdict at import time. If the exact same file is already in the vault, returns that one.
   */
  addDocument({ name, bytes, folder = null, inspect = {}, verification = null }) {
    this._assertOpen();
    const data = Buffer.from(bytes);
    const fileHash = fileFingerprint(data);
    const existing = this.index.docs.find((d) => d.fileHash === fileHash && !d.destroyedAt);
    if (existing) return { doc: publicDoc(existing), duplicate: true };
    const blobId = newId();
    const fileKey = C.randomKey();
    writeAtomic(this._blobPath(blobId), C.encrypt(fileKey, data, `blob:${blobId}`));
    const doc = {
      id: newId(),
      blobId,
      name: String(name || 'document.pdf').slice(0, 255),
      size: data.length,
      addedAt: new Date().toISOString(),
      folder: folder || null,
      fileHash,
      ids: {
        contractId: inspect.contractId || null,
        agreementId: inspect.agreementId || null,
        contentHash: inspect.contentHash || null,
        sealTx: inspect.sealTx || null,
        title: inspect.title || null,
      },
      wordingDigest: inspect.wordingDigest || null,
      verification,
      onlineCheck: null,
      sealedAt: verification?.sealedAt || null,
      policy: null,
      legalHold: false,
      fileKey: fileKey.toString('base64'),
    };
    C.wipe(fileKey);
    this.index.docs.push(doc);
    this._save();
    return { doc: publicDoc(doc), duplicate: false };
  }

  /** Decrypts a document. Returns a Buffer; the caller decides where it goes. */
  readDocument(id) {
    const d = this.get(id);
    if (d.destroyedAt) throw new Error('This document was destroyed.');
    const key = Buffer.from(d.fileKey, 'base64');
    try {
      const data = C.decrypt(key, fs.readFileSync(this._blobPath(d.blobId)), `blob:${d.blobId}`);
      if (fileFingerprint(data) !== d.fileHash) throw new Error('The stored file does not match its fingerprint.');
      return data;
    } finally {
      C.wipe(key);
    }
  }

  updateDocument(id, patch, { acknowledgeShort = false } = {}) {
    const d = this.get(id);
    if (d.destroyedAt) throw new Error('This document was destroyed.');
    for (const k of Object.keys(patch || {})) {
      if (!EDITABLE.includes(k)) throw new Error(`Cannot change ${k}.`);
    }
    if ('policy' in patch) {
      // null = follow the folder's rule; { mode: 'keep' } = keep, even if the folder says destroy.
      patch.policy = patch.policy
        ? R.validatePolicy(patch.policy, d, { minDays: this.index.settings.minRetentionDays, acknowledgeShort })
        : null;
    }
    if ('label' in patch) patch.label = N.cleanLabel(patch.label);
    if ('notes' in patch) {
      patch.notes = patch.notes ? String(patch.notes).slice(0, MAX_NOTES + 1) : null;
      if (patch.notes && patch.notes.length > MAX_NOTES) throw new Error(`Keep notes under ${MAX_NOTES} characters.`);
    }
    if ('folder' in patch && patch.folder && !this.index.folders[patch.folder]) this.index.folders[patch.folder] = {};
    Object.assign(d, patch);
    this._save();
    return publicDoc(d);
  }

  /**
   * Records that a decrypted copy left the vault (kept in the encrypted index). Only the file name
   * is kept, not the folder it was saved to.
   */
  recordExport(id, { kind, note = null, fileName = null }) {
    const d = this.get(id);
    if (d.destroyedAt) throw new Error('This document was destroyed.');
    if (!['original', 'pack'].includes(kind)) throw new Error('Unknown export type.');
    const entry = {
      at: new Date().toISOString(),
      kind,
      note: note ? String(note).replace(/\s+/g, ' ').trim().slice(0, 300) || null : null,
      fileName: fileName ? path.basename(String(fileName)).slice(0, 255) : null,
    };
    d.exports = [...(d.exports || []), entry].slice(-MAX_EXPORTS);
    this._save();
    return publicDoc(d);
  }

  // ───────────────────────────── folders

  folders() {
    this._assertOpen();
    return Object.entries(this.index.folders).map(([name, f]) => ({ name, ...f, count: this.index.docs.filter((d) => d.folder === name && !d.destroyedAt).length }));
  }

  setFolder(name, { policy, legalHold } = {}, { acknowledgeShort = false } = {}) {
    this._assertOpen();
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) throw new Error('Give the folder a name.');
    const f = this.index.folders[clean] || {};
    if (policy !== undefined) {
      f.policy = policy
        ? R.validatePolicy(policy, null, { minDays: this.index.settings.minRetentionDays, acknowledgeShort })
        : null;
    }
    if (legalHold !== undefined) f.legalHold = !!legalHold;
    this.index.folders[clean] = f;
    this._save();
    return { name: clean, ...f };
  }

  removeFolder(name) {
    this._assertOpen();
    for (const d of this.index.docs) if (d.folder === name) d.folder = null;
    delete this.index.folders[name];
    this._save();
  }

  setMinRetentionDays(days) {
    this._assertOpen();
    this.index.settings.minRetentionDays = Math.max(0, Math.floor(Number(days) || 0));
    this._save();
  }

  // ───────────────────────────── destruction

  /**
   * Destroys a document: deletes its encrypted file and its key, keeps a signed receipt.
   * The fingerprint on the blockchain is untouched (it reveals nothing about the contents).
   */
  destroyDocument(id, { reason = 'manual', rule = null } = {}) {
    const d = this.get(id);
    if (d.destroyedAt) throw new Error('Already destroyed.');
    const eff = R.effectivePolicy(d, this.index.folders);
    if (eff.legalHold) throw new Error('This document is on legal hold. Remove the hold before destroying it.');
    try { fs.rmSync(this._blobPath(d.blobId), { force: true }); } catch { /* already gone */ }
    return this._recordDestruction(d, { reason, rule: rule || (reason === 'manual' ? null : eff.policy) });
  }

  _recordDestruction(d, { reason, rule, destroyedAt = new Date().toISOString() }) {
    delete d.fileKey;
    d.wordingDigest = null;
    d.destroyedAt = destroyedAt;
    const payload = {
      type: 'immupact-vault/destruction-receipt',
      version: 1,
      vaultId: this.meta.id,
      documentId: d.id,
      name: d.name,
      displayName: N.displayName(d),
      fileHash: d.fileHash,
      contractId: d.ids?.contractId || null,
      agreementId: d.ids?.agreementId || null,
      reason,
      rule: rule || null,
      destroyedAt,
      // Decrypted copies that left the vault before this (they are not affected by destruction).
      exportedCopies: (d.exports || []).length,
    };
    const receipt = { ...payload, signature: C.sign(this.index.signingKey, payload), publicKey: this.meta.receiptPublicKey };
    d.receipt = receipt;
    this.index.receipts.push(receipt);
    this._save();
    return receipt;
  }

  /** Destroys every document whose rule has come due. Returns the receipts. */
  enforceRetention(now = Date.now()) {
    this._assertOpen();
    return R.dueForDestruction(this.index.docs, this.index.folders, now).map((d) => this.destroyDocument(d.id, { reason: 'retention_rule' }));
  }

  /**
   * Runs while the vault is LOCKED (e.g. at app start): deletes encrypted files whose destroy-by
   * date has passed, using only schedule.json. Receipts are written at the next unlock.
   */
  static sweepSchedule(dir, now = Date.now()) {
    const file = path.join(dir, SCHEDULE_FILE);
    if (!fs.existsSync(file)) return [];
    const schedule = JSON.parse(fs.readFileSync(file, 'utf8'));
    const removed = [];
    for (const [blobId, due] of Object.entries(schedule)) {
      if (!/^[0-9a-f]{24}$/.test(blobId) || Date.parse(due) > now) continue;
      const p = path.join(dir, BLOBS, `${blobId}.bin`);
      if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); removed.push(blobId); }
    }
    return removed;
  }

  _reconcileLockedDestructions() {
    // Files removed by sweepSchedule while locked: finish the job and write receipts.
    // A file that is missing for any other reason is flagged, never silently marked destroyed.
    let changed = false;
    for (const d of this.index.docs) {
      if (d.destroyedAt) continue;
      const present = fs.existsSync(this._blobPath(d.blobId));
      const eff = R.effectivePolicy(d, this.index.folders);
      const due = R.dueDate(d, eff.policy);
      if (!present && due && !eff.legalHold && Date.parse(due) <= Date.now()) {
        this._recordDestruction(d, { reason: 'retention_rule_while_locked', rule: eff.policy, destroyedAt: due });
        changed = true;
      } else if (!present !== !!d.missing) {
        d.missing = !present;
        changed = true;
      }
    }
    if (changed) this._save();
    return changed;
  }

  receipts() {
    this._assertOpen();
    return [...this.index.receipts];
  }

  static verifyReceipt(receipt) {
    const { signature, publicKey, ...payload } = receipt || {};
    return !!(signature && publicKey) && C.verifySignature(publicKey, payload, signature);
  }

  // ───────────────────────────── backup

  /**
   * Copies the vault (still encrypted) into a new folder inside `destDir`, e.g. a folder your
   * own cloud drive syncs. Anyone holding the backup still needs your passphrase or phrase.
   */
  backup(destDir) {
    this._assertOpen();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(destDir, `immupact-vault-backup-${stamp}`);
    fs.mkdirSync(path.join(out, BLOBS), { recursive: true });
    for (const f of [VAULT_FILE, INDEX_FILE, SCHEDULE_FILE]) {
      if (fs.existsSync(path.join(this.dir, f))) fs.copyFileSync(path.join(this.dir, f), path.join(out, f));
    }
    for (const d of this.index.docs) {
      if (!d.destroyedAt && fs.existsSync(this._blobPath(d.blobId))) {
        fs.copyFileSync(this._blobPath(d.blobId), path.join(out, BLOBS, `${d.blobId}.bin`));
      }
    }
    return out;
  }
}

module.exports = { Vault, VAULT_FILE, INDEX_FILE, SCHEDULE_FILE, MIN_PASSPHRASE };
