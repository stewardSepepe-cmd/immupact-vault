'use strict';
// Electron main process. Holds the unlocked vault (and its key) in memory; the window only ever
// gets document metadata through the narrow API in preload.js.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { Vault } = require('../core/store');
const { importFile, recheck } = require('../core/importer');
const { onlineWordingCheck } = require('../core/verify');
const { buildPack } = require('../core/pack');
const { safeFileName } = require('../core/naming');
const { NETWORKS } = require('../core/standard');
const { Settings } = require('./settings');

let win = null;
let vault = null;
let settings = null;
let lockTimer = null;
let watcher = null;
const viewers = new Map(); // webContents id -> { window, payload (handed over once) }
const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'icon-256.png');
const RETENTION_EVERY_MS = 10 * 60 * 1000;

// One running copy only (also routes immupact-vault:// links to it).
if (!app.requestSingleInstanceLock()) app.quit();
app.setAsDefaultProtocolClient('immupact-vault');

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ───────────────────────────── locking

function closeViewers() {
  for (const { window, payload } of viewers.values()) {
    if (payload?.bytes) payload.bytes.fill(0);
    if (!window.isDestroyed()) window.destroy();
  }
  viewers.clear();
}

function lockVault(reason = 'manual') {
  closeViewers(); // decrypted pages never outlive the unlocked vault
  if (vault) { vault.lock(); vault = null; }
  clearTimeout(lockTimer);
  send('vault:locked', { reason });
}

function touch() {
  clearTimeout(lockTimer);
  if (vault) lockTimer = setTimeout(() => lockVault('idle'), settings.get('autoLockMinutes') * 60 * 1000);
}

function requireVault() {
  if (!vault || !vault.isOpen) throw new Error('The vault is locked.');
  touch();
  return vault;
}

// ───────────────────────────── retention

function runRetention() {
  const dir = settings.get('vaultDir');
  if (!dir || !Vault.exists(dir)) return;
  try {
    if (vault && vault.isOpen) {
      const receipts = vault.enforceRetention();
      if (receipts.length) send('vault:destroyed', receipts.map((r) => ({ name: r.name, destroyedAt: r.destroyedAt })));
    } else {
      Vault.sweepSchedule(dir); // locked: delete due files now, write receipts at next unlock
    }
  } catch (err) {
    console.error('retention run failed', err.message);
  }
}

// ───────────────────────────── watch folder

function startWatcher() {
  if (watcher) { watcher.close(); watcher = null; }
  if (!settings.get('watchEnabled')) return;
  const dir = settings.get('watchDir') || app.getPath('downloads');
  try {
    watcher = fs.watch(dir, (event, file) => {
      if (!file || !/-FINAL\.pdf$/i.test(file)) return;
      const full = path.join(dir, file);
      setTimeout(() => { if (fs.existsSync(full)) send('watch:found', { path: full, name: file }); }, 1500);
    });
  } catch (err) {
    console.error('watch folder unavailable', err.message);
  }
}

// ───────────────────────────── IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  });
}

function chainOptions() {
  return { network: settings.get('network'), rpcs: settings.get('rpcs') };
}

function snapshot() {
  const v = requireVault();
  return { docs: v.list(), folders: v.folders(), minRetentionDays: v.index.settings.minRetentionDays, vaultId: v.meta.id };
}

function registerIpc() {
  handle('app:state', () => ({
    vaultDir: settings.get('vaultDir'),
    hasVault: !!settings.get('vaultDir') && Vault.exists(settings.get('vaultDir')),
    unlocked: !!(vault && vault.isOpen),
    settings: settings.all(),
    network: NETWORKS[settings.get('network')]?.name,
    version: app.getVersion(),
  }));

  handle('vault:chooseFolder', async (purpose) => {
    const r = await dialog.showOpenDialog(win, {
      title: purpose === 'open' ? 'Choose an existing vault folder' : 'Choose an empty folder for your vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('vault:create', (dir, passphrase) => {
    if (fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length) {
      throw new Error('Choose an empty folder for a new vault.');
    }
    const { vault: v, recoveryPhrase } = Vault.create(dir, passphrase);
    vault = v;
    settings.set({ vaultDir: dir });
    touch();
    return { recoveryPhrase };
  });

  handle('vault:useExisting', (dir) => {
    if (!Vault.exists(dir)) throw new Error('There is no vault in that folder.');
    settings.set({ vaultDir: dir });
    return true;
  });

  handle('vault:unlock', (passphrase) => {
    vault = Vault.open(settings.get('vaultDir'), passphrase);
    touch();
    runRetention();
    return true;
  });

  handle('vault:recover', (phrase, newPassphrase) => {
    vault = Vault.recover(settings.get('vaultDir'), phrase, newPassphrase);
    touch();
    runRetention();
    return true;
  });

  handle('vault:lock', () => { lockVault('manual'); return true; });
  handle('vault:changePassphrase', (newPassphrase) => { requireVault().changePassphrase(newPassphrase); return true; });
  handle('vault:snapshot', () => snapshot());

  handle('docs:importDialog', async (folder) => {
    requireVault();
    const r = await dialog.showOpenDialog(win, {
      title: 'Add documents to your vault', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled) return [];
    return importPaths(r.filePaths, folder);
  });

  handle('docs:importPaths', (paths, folder) => importPaths(paths, folder));

  handle('docs:recheck', async (id) => recheck(requireVault(), id, chainOptions()));

  handle('docs:onlineCheck', async (id) => {
    if (!settings.get('onlineChecks')) throw new Error('Online checks are off. Turn them on in Settings.');
    const v = requireVault();
    const d = v.get(id);
    const result = await onlineWordingCheck({
      apiUrl: settings.get('immupactVerifyUrl'), contractId: d.ids?.contractId, fileHash: d.fileHash, wordingDigest: d.wordingDigest,
    });
    return v.updateDocument(id, { onlineCheck: { ...result, checkedAt: new Date().toISOString(), data: undefined } });
  });

  handle('docs:view', (id, verdict) => openViewer(id, verdict));

  // A byte-for-byte copy of the original. It verifies as the anchored file wherever it goes.
  handle('docs:exportOriginal', async (id, { note = null, legalHold = false } = {}) => {
    const v = requireVault();
    const d = v.get(id);
    const r = await dialog.showSaveDialog(win, { title: 'Export the original file', defaultPath: safeFileName(d.name), buttonLabel: 'Export' });
    if (r.canceled || !r.filePath) return null;
    const bytes = v.readDocument(id);
    try { fs.writeFileSync(r.filePath, bytes); } finally { bytes.fill(0); }
    let doc = v.recordExport(id, { kind: 'original', note, fileName: r.filePath });
    if (legalHold && !d.legalHold) doc = v.updateDocument(id, { legalHold: true });
    return { path: r.filePath, doc };
  });

  // The original plus a proof sheet, proof.json and instructions, in one ZIP.
  handle('docs:exportPack', async (id, { note = null, legalHold = false } = {}) => {
    const v = requireVault();
    let d = v.get(id);
    // Check the chain again so the sheet records a fresh result; offline keeps the last one.
    let verification = d.verification;
    try { d = (await recheck(v, id, chainOptions())) && v.get(id); verification = d.verification; } catch { /* offline */ }
    const bytes = v.readDocument(id);
    let pack;
    try {
      pack = await buildPack({ doc: v.list().find((x) => x.id === id), bytes, verification, network: settings.get('network'), appVersion: app.getVersion() });
    } finally { bytes.fill(0); }
    const r = await dialog.showSaveDialog(win, {
      title: 'Save the verification pack', defaultPath: pack.fileName, buttonLabel: 'Save pack',
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, pack.zip);
    let doc = v.recordExport(id, { kind: 'pack', note, fileName: r.filePath });
    if (legalHold && !d.legalHold) doc = v.updateDocument(id, { legalHold: true });
    return { path: r.filePath, doc, verdict: verification?.verdict || 'unchecked' };
  });

  handle('docs:update', (id, patch, opts) => requireVault().updateDocument(id, patch, opts));
  handle('docs:destroy', (id) => requireVault().destroyDocument(id, { reason: 'manual' }));
  handle('docs:receipts', () => requireVault().receipts());

  handle('folders:set', (name, opts, ack) => requireVault().setFolder(name, opts, ack));
  handle('folders:remove', (name) => { requireVault().removeFolder(name); return true; });
  handle('vault:setMinRetentionDays', (days) => { requireVault().setMinRetentionDays(days); return true; });

  handle('vault:backup', async () => {
    const v = requireVault();
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose where to put the encrypted backup (e.g. a folder your cloud drive syncs)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled) return null;
    return v.backup(r.filePaths[0]);
  });

  handle('settings:set', (patch) => {
    const s = settings.set(patch);
    startWatcher();
    touch();
    return s;
  });

  handle('shell:openExternal', (url) => {
    const ok = /^https:\/\/(sepolia\.etherscan\.io|etherscan\.io|immupact\.com|verify\.immupact\.com|github\.com)\//.test(String(url));
    if (!ok) throw new Error('Blocked link.');
    return shell.openExternal(url);
  });
}

function sniffMime(buf) {
  const head = buf.subarray(0, 12);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

/**
 * Opens a read-only viewer window. The decrypted bytes stay in memory: they are handed to that
 * window once, then wiped here. Nothing is written to disk.
 */
function openViewer(id, verdict) {
  const v = requireVault();
  const d = v.list().find((x) => x.id === id);
  if (!d) throw new Error('Document not found.');
  if (d.destroyedAt) throw new Error('This document was destroyed.');
  const bytes = v.readDocument(id);
  const mime = sniffMime(bytes);
  if (mime === 'application/octet-stream') { bytes.fill(0); throw new Error('This type of file cannot be shown in the vault. Use "Export original" to open it in another app.'); }
  const clean = (x) => String(x ?? '').slice(0, 600);
  const viewer = new BrowserWindow({
    width: 980, height: 900, minWidth: 520, minHeight: 400,
    title: `${d.displayName} · ImmuPact Vault`,
    backgroundColor: '#1a1f2a', icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'viewer-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      // Separate in-memory session: no disk cache, no storage shared with the main window.
      partition: `viewer-${crypto.randomUUID()}`,
    },
  });
  viewer.removeMenu();
  if (settings.get('protectViewer')) viewer.setContentProtection(true);
  viewer.webContents.on('will-navigate', (e) => e.preventDefault());
  viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  viewer.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // No printing or saving from the viewer: sharing goes through "Export original".
  viewer.webContents.on('before-input-event', (e, input) => {
    if ((input.control || input.meta) && ['p', 's'].includes(String(input.key).toLowerCase())) e.preventDefault();
  });
  const wcId = viewer.webContents.id;
  viewers.set(wcId, {
    window: viewer,
    payload: {
      bytes, mime, name: clean(d.name), displayName: clean(d.displayName),
      verdict: verdict ? { cls: clean(verdict.cls), label: clean(verdict.label), text: clean(verdict.text) } : null,
    },
  });
  viewer.on('closed', () => {
    const entry = viewers.get(wcId);
    if (entry?.payload?.bytes) entry.payload.bytes.fill(0);
    viewers.delete(wcId);
  });
  viewer.loadFile(path.join(__dirname, '..', 'renderer', 'viewer.html'));
  touch();
  return true;
}

function registerViewerIpc() {
  ipcMain.handle('viewer:load', (e) => {
    const entry = viewers.get(e.sender.id);
    if (!entry || !entry.payload) return { ok: false, error: 'This document is no longer available. Open it again from the vault.' };
    if (!vault || !vault.isOpen) return { ok: false, error: 'The vault is locked.' };
    const { bytes, ...meta } = entry.payload;
    entry.payload = null; // handed over once
    const copy = new Uint8Array(bytes); // structured-cloned to the viewer
    bytes.fill(0);
    setTimeout(() => copy.fill(0), 5000); // long after it has been sent
    return { ok: true, value: { ...meta, bytes: copy } };
  });
}

async function importPaths(paths, folder) {
  const v = requireVault();
  const results = [];
  for (const p of (paths || []).slice(0, 50)) {
    try {
      const r = await importFile(v, p, { folder, ...chainOptions() });
      results.push({ path: p, ok: true, duplicate: r.duplicate, doc: r.doc });
    } catch (err) {
      results.push({ path: p, ok: false, error: err.message });
    }
  }
  return results;
}

// ───────────────────────────── window

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    title: 'ImmuPact Vault',
    backgroundColor: '#0a0c10',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // The window never navigates anywhere or opens other windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Closing the vault window locks the vault and closes any open documents.
  win.on('closed', () => { win = null; lockVault('closed'); app.quit(); });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('open-url', (e) => { e.preventDefault(); if (win) win.focus(); }); // immupact-vault:// hand-off (reserved)

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  registerIpc();
  registerViewerIpc();
  if (process.platform === 'darwin' && !app.isPackaged) {
    try { app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png')); } catch { /* optional */ }
  }
  runRetention(); // destroy due files even before anyone unlocks
  setInterval(runRetention, RETENTION_EVERY_MS);
  startWatcher();
  createWindow();
  // Lock when the computer sleeps or the screen locks.
  const { powerMonitor } = require('electron');
  powerMonitor.on('suspend', () => lockVault('sleep'));
  powerMonitor.on('lock-screen', () => lockVault('screen-lock'));
});

app.on('before-quit', () => closeViewers());
app.on('window-all-closed', () => {
  lockVault('closed');
  app.quit();
});
