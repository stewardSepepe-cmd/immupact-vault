'use strict';
/* global vault */
// ImmuPact Vault window. Plain JavaScript, no framework, no remote code. All data reaches the
// page through window.vault (see src/main/preload.js). Text is always set with textContent.

const root = document.getElementById('app');
const ui = { view: null, snapshot: null, filter: { kind: 'all' }, selected: null, settings: null, network: '', query: '', renaming: false };

// ───────────────────────────── tiny DOM helper

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function mount(node) {
  root.replaceChildren(node);
}

function toast(message, kind = '', action) {
  const t = h('div', { class: `toast ${kind}` }, message);
  if (action) t.append(' ', h('button', { class: 'link', onclick: () => { action.run(); t.remove(); } }, action.label));
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), action ? 15000 : 6000);
}

async function attempt(fn, errorEl) {
  try {
    if (errorEl) errorEl.textContent = '';
    return await fn();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message; else toast(err.message, 'error');
    return undefined;
  }
}

const brand = () => h('div', { class: 'brand' }, h('img', { class: 'mark', src: 'assets/logo.png', alt: '' }), h('span', null, 'ImmuPact ', h('b', null, 'Vault')));
const nameOf = (d) => d.displayName || d.ids?.title || d.name;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ───────────────────────────── start

async function boot(message) {
  const s = await vault.state();
  ui.settings = s.settings;
  ui.network = s.network;
  if (!s.hasVault) return viewSetup();
  if (!s.unlocked) return viewUnlock(message);
  return viewMain();
}

// ───────────────────────────── setup

function viewSetup() {
  const err = h('div', { class: 'error' });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 12 characters' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  let folder = null;
  const folderLabel = h('div', { class: 'mono muted' }, 'No folder chosen');

  const choose = async () => {
    const f = await attempt(() => vault.chooseFolder('create'), err);
    if (f) { folder = f; folderLabel.textContent = f; }
  };
  const create = async () => {
    if (!folder) { err.textContent = 'Choose a folder for your vault first.'; return; }
    if (pass.value !== pass2.value) { err.textContent = 'The two passphrases do not match.'; return; }
    const r = await attempt(() => vault.create(folder, pass.value), err);
    if (r) viewPhrase(r.recoveryPhrase);
  };
  const openExisting = async () => {
    const f = await attempt(() => vault.chooseFolder('open'), err);
    if (f && await attempt(() => vault.useExisting(f), err)) boot();
  };

  mount(h('div', { class: 'center' }, h('div', { class: 'card' },
    brand(),
    h('h1', null, 'Create your vault'),
    h('p', { class: 'muted' }, 'Your signed documents are encrypted and kept in a folder on this computer. Nobody else, including ImmuPact, can open them.'),
    h('label', null, 'Vault folder'),
    h('div', { class: 'row' }, h('button', { onclick: choose }, 'Choose folder…'), folderLabel),
    h('p', { class: 'small dim' }, 'Tip: a folder on this computer is safest. Use "Back up" later to copy the encrypted vault to your cloud drive.'),
    h('label', null, 'Passphrase'), pass,
    h('label', null, 'Repeat passphrase'), pass2,
    err,
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'primary', onclick: create }, 'Create vault'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'link', onclick: openExisting }, 'Open an existing vault folder')),
  )));
}

function viewPhrase(phrase) {
  const ok = h('input', { type: 'checkbox', id: 'wrote', style: 'width:auto' });
  const go = h('button', { class: 'primary', disabled: true, onclick: () => viewMain() }, 'I have saved it, continue');
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  mount(h('div', { class: 'center' }, h('div', { class: 'card' },
    brand(),
    h('h1', null, 'Your recovery phrase'),
    h('p', { class: 'muted' }, 'These 24 words open your vault if you forget your passphrase. Write them down on paper, in order, and keep them somewhere safe.'),
    h('div', { class: 'phrase' }, phrase.split(' ').map((w) => h('span', null, w))),
    h('div', { class: 'note warn' }, 'This is the only time they are shown. Anyone with these words can open your vault. ImmuPact cannot recover them for you.'),
    h('div', { class: 'row' }, ok, h('label', { for: 'wrote', style: 'margin:0' }, 'I have written down all 24 words')),
    h('div', { class: 'row', style: 'margin-top:16px' }, go),
  )));
}

// ───────────────────────────── unlock / recover

function viewUnlock(message) {
  const err = h('div', { class: 'error' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', autofocus: true });
  const unlock = async () => { if (await attempt(() => vault.unlock(pass.value), err)) viewMain(); };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  mount(h('div', { class: 'center' }, h('div', { class: 'card' },
    brand(),
    h('h1', null, 'Unlock your vault'),
    message ? h('div', { class: 'note info' }, message) : null,
    h('label', null, 'Passphrase'), pass, err,
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'primary', onclick: unlock }, 'Unlock'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'link', onclick: viewRecover }, 'Forgot it? Use your recovery phrase')),
  )));
  setTimeout(() => pass.focus(), 50);
}

function viewRecover() {
  const err = h('div', { class: 'error' });
  const phrase = h('textarea', { rows: 4, style: 'width:100%;background:#080a0e;border:1px solid #1e2533;border-radius:8px;padding:8px;color:inherit', placeholder: 'word1 word2 … word24' });
  const pass = h('input', { type: 'password', autocomplete: 'new-password' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const go = async () => {
    if (pass.value !== pass2.value) { err.textContent = 'The two passphrases do not match.'; return; }
    if (await attempt(() => vault.recover(phrase.value, pass.value), err)) { toast('Vault recovered. Your new passphrase is set.', 'ok'); viewMain(); }
  };
  mount(h('div', { class: 'center' }, h('div', { class: 'card' },
    brand(),
    h('h1', null, 'Recover with your 24 words'),
    h('label', null, 'Recovery phrase'), phrase,
    h('label', null, 'New passphrase'), pass,
    h('label', null, 'Repeat new passphrase'), pass2, err,
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'primary', onclick: go }, 'Recover vault'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'link', onclick: () => viewUnlock() }, 'Back')),
  )));
}

// ───────────────────────────── verdicts

function verdictOf(d) {
  if (d.destroyedAt) return { cls: 'grey', label: 'Destroyed', text: `Destroyed on ${fmtDate(d.destroyedAt)}. A signed receipt was kept.` };
  if (d.missing) return { cls: 'red', label: 'File missing', text: 'The encrypted file is missing from the vault folder. Restore it from a backup.' };
  const o = d.onlineCheck;
  const v = d.verification;
  if (v?.verdict === 'anchored') return { cls: 'green', label: 'Anchored file', text: 'Exact match with the final PDF anchored on the blockchain.' };
  if (o?.verdict === 'genuine_wording') return { cls: 'amber', label: 'Genuine wording', text: 'Not the anchored file, but its wording is exactly what was signed (checked with ImmuPact). Every download gets a new timestamp, which changes the file fingerprint.' };
  if (o?.verdict === 'altered') return { cls: 'red', label: 'Altered', text: 'Neither the file nor its wording matches the sealed record. Do not rely on it.' };
  if (o?.verdict === 'wording_unverifiable') return { cls: 'grey', label: 'Not the anchored file', text: 'Its wording could not be compared automatically. Keep the -FINAL.pdf instead.' };
  switch (v?.verdict) {
    case 'not_anchored': return v.v1
      ? { cls: 'grey', label: 'Sealed (v1)', text: 'This agreement was sealed on the first ImmuPact contract, which records the wording only, so no PDF can be an exact match.' }
      : { cls: 'grey', label: 'Not the anchored file', text: 'The agreement is on the blockchain, but this exact file is not the anchored final PDF. Use the online wording check to confirm the text.' };
    case 'not_found': return { cls: 'red', label: 'Not on blockchain', text: 'No agreement was found on the blockchain for this document.' };
    case 'unknown': return { cls: 'grey', label: 'Not ImmuPact', text: 'This file has no ImmuPact document ID. It is stored and encrypted, but cannot be verified.' };
    case 'unchecked': return { cls: 'grey', label: 'Not checked', text: `Could not reach the blockchain when it was added (${v.error || 'offline'}). Check it again when online.` };
    default: return { cls: 'grey', label: 'Not checked', text: 'Not checked yet.' };
  }
}

const badge = (d) => { const v = verdictOf(d); return h('span', { class: `badge ${v.cls}` }, v.label); };

function ruleText(d) {
  const e = d.effective;
  if (!e) return '—';
  const hold = e.legalHold ? ' · legal hold' : '';
  if (e.policy.mode === 'keep') return `Keep${hold}`;
  return `Destroy ${fmtDate(e.due)}${e.source === 'folder' ? ' (folder)' : ''}${hold}`;
}

// ───────────────────────────── main screen

async function refresh() {
  ui.snapshot = await attempt(() => vault.snapshot());
  if (!ui.snapshot) return boot();
  renderMain();
}

async function viewMain() {
  const s = await vault.state();
  ui.settings = s.settings;
  ui.network = s.network;
  await refresh();
}

function searchText(d) {
  return [nameOf(d), d.name, d.ids?.title, d.notes, d.folder, d.ids?.contractId].filter(Boolean).join(' ').toLowerCase();
}

function visibleDocs() {
  const docs = ui.snapshot.docs;
  const f = ui.filter;
  const q = ui.query.trim().toLowerCase();
  const match = (list) => (q ? list.filter((d) => q.split(/\s+/).every((w) => searchText(d).includes(w))) : list);
  if (f.kind === 'destroyed') return match(docs.filter((d) => d.destroyedAt));
  const live = docs.filter((d) => !d.destroyedAt);
  if (f.kind === 'folder') return match(live.filter((d) => d.folder === f.name));
  if (f.kind === 'unfiled') return match(live.filter((d) => !d.folder));
  return match(live);
}

async function importPaths(paths) {
  const folder = ui.filter.kind === 'folder' ? ui.filter.name : null;
  const results = await attempt(() => vault.importPaths(paths, folder));
  reportImports(results);
}

function reportImports(results) {
  if (!results) return;
  for (const r of results) {
    if (!r.ok) toast(`${r.path.split(/[\\/]/).pop()}: ${r.error}`, 'error');
    else if (r.duplicate) toast(`${nameOf(r.doc)} is already in your vault.`);
    else { toast(`Added ${nameOf(r.doc)}: ${verdictOf(r.doc).label}.`, 'ok'); ui.selected = r.doc.id; }
  }
  refresh();
}

function renderMain() {
  const snap = ui.snapshot;
  const docs = visibleDocs();
  if (ui.selected && !snap.docs.find((d) => d.id === ui.selected)) ui.selected = null;

  const header = h('header', { class: 'top' },
    brand(),
    h('span', { class: 'small dim' }, ui.network || ''),
    h('span', { class: 'spacer' }),
    h('button', { class: 'primary', onclick: async () => reportImports(await attempt(() => vault.importDialog(ui.filter.kind === 'folder' ? ui.filter.name : null))) }, 'Add documents'),
    h('button', { onclick: async () => { const p = await attempt(() => vault.backup()); if (p) toast(`Encrypted backup saved to ${p}`, 'ok'); } }, 'Back up'),
    h('button', { onclick: openReceipts }, 'Receipts'),
    h('button', { onclick: openSettings }, 'Settings'),
    h('button', { onclick: async () => { await vault.lock(); viewUnlock('Locked.'); } }, 'Lock'));

  const navItem = (label, filter, count) => h('button', {
    class: JSON.stringify(ui.filter) === JSON.stringify(filter) ? 'active' : '',
    onclick: () => { ui.filter = filter; renderMain(); },
  }, h('span', null, label), h('span', { class: 'dim' }, count ?? ''));
  const live = snap.docs.filter((d) => !d.destroyedAt);
  const side = h('nav', { class: 'side' },
    navItem('All documents', { kind: 'all' }, live.length),
    navItem('Not in a folder', { kind: 'unfiled' }, live.filter((d) => !d.folder).length),
    h('div', { class: 'section' }, 'Folders'),
    snap.folders.map((f) => navItem(`${f.name}${f.legalHold ? ' ⚖' : ''}`, { kind: 'folder', name: f.name }, f.count)),
    h('button', { onclick: () => openFolderEditor(null) }, h('span', { class: 'dim' }, '+ New folder')),
    h('div', { class: 'section' }, 'History'),
    navItem('Destroyed', { kind: 'destroyed' }, snap.docs.length - live.length));

  const drop = h('div', { class: 'drop' }, 'Drop PDFs here to add them. Final signed PDFs (…-FINAL.pdf) verify as an exact match.');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const paths = [...e.dataTransfer.files].map((f) => vault.pathForFile(f)).filter(Boolean);
    if (paths.length) importPaths(paths);
  });

  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search names, titles, notes…', value: ui.query, 'aria-label': 'Search documents' });
  search.addEventListener('input', () => {
    ui.query = search.value;
    const pos = search.selectionStart;
    renderMain();
    const again = document.querySelector('input.search');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });

  const folderTools = ui.filter.kind === 'folder'
    ? h('div', { class: 'row', style: 'margin-bottom:10px' },
      h('h2', { style: 'font-size:16px' }, ui.filter.name),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => openFolderEditor(ui.filter.name) }, 'Folder rules'))
    : null;

  const table = docs.length
    ? h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Document'), h('th', null, 'Status'), h('th', null, 'Folder'), h('th', null, 'Retention'), h('th', null, 'Added'))),
      h('tbody', null, docs.map((d) => h('tr', {
        class: `doc ${ui.selected === d.id ? 'selected' : ''}`,
        onclick: () => { ui.selected = d.id; ui.renaming = false; renderMain(); },
      },
      h('td', null, h('div', null, nameOf(d)), h('div', { class: 'small dim' }, d.name)),
      h('td', null, badge(d)),
      h('td', { class: 'small muted' }, d.folder || '—'),
      h('td', { class: 'small muted' }, d.destroyedAt ? '—' : ruleText(d)),
      h('td', { class: 'small muted' }, fmtDate(d.addedAt))))))
    : h('div', { class: 'empty' }, ui.query.trim() ? 'Nothing matches your search.' : ui.filter.kind === 'destroyed' ? 'Nothing has been destroyed.' : 'No documents here yet. Add your signed -FINAL.pdf files.');

  const list = h('main', { class: 'list' }, ui.filter.kind === 'destroyed' ? null : drop, folderTools, search, table);
  const selected = snap.docs.find((d) => d.id === ui.selected);
  const detail = h('aside', { class: 'detail' }, selected ? renderDetail(selected) : h('div', { class: 'empty' }, 'Select a document to see its proof, rules and actions.'));

  mount(h('div', { class: 'shell' }, header, h('div', { class: 'body' }, side, list, detail)));
}

function renderDetail(d) {
  const v = verdictOf(d);
  const ver = d.verification || {};
  const etherscan = (hash) => h('button', { class: 'link small', onclick: () => attempt(() => vault.openExternal(`https://sepolia.etherscan.io/tx/${hash}`)) }, 'View on Etherscan');

  const proof = h('div', { class: 'box' },
    h('div', { class: 'row', style: 'margin-bottom:6px' }, h('span', { class: `badge ${v.cls}` }, v.label)),
    h('p', { class: 'small muted', style: 'margin:0 0 8px' }, v.text),
    h('dl', { class: 'kv' },
      ver.status ? [h('dt', null, 'On-chain'), h('dd', null, `${ver.status.replace(/_/g, ' ')}${ver.required ? ` · ${ver.signed}/${ver.required} signed` : ''}`)] : null,
      d.sealedAt ? [h('dt', null, 'Sealed'), h('dd', null, fmtDate(d.sealedAt))] : null,
      ver.checkedAt ? [h('dt', null, 'Last checked'), h('dd', null, new Date(ver.checkedAt).toLocaleString())] : null,
      h('dt', null, 'File fingerprint'), h('dd', { class: 'mono' }, d.fileHash),
      d.ids?.contractId ? [h('dt', null, 'Document ID'), h('dd', { class: 'mono' }, d.ids.contractId)] : null,
      d.ids?.agreementId ? [h('dt', null, 'Agreement'), h('dd', { class: 'mono' }, d.ids.agreementId)] : null,
      d.ids?.sealTx ? [h('dt', null, 'Seal TX'), h('dd', null, etherscan(d.ids.sealTx))] : null),
    d.destroyedAt ? null : h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { onclick: async () => { if (await attempt(() => vault.recheck(d.id))) { toast('Checked on the blockchain.', 'ok'); refresh(); } } }, 'Check again'),
      ui.settings?.onlineChecks && d.ids?.contractId && ver.verdict !== 'anchored'
        ? h('button', { onclick: async () => { if (await attempt(() => vault.onlineCheck(d.id))) refresh(); } }, 'Online wording check')
        : null));

  if (d.destroyedAt) {
    return h('div', null,
      h('h2', { style: 'font-size:16px' }, nameOf(d)),
      proof,
      exportLog(d),
      h('div', { class: 'box' }, h('h3', null, 'Destruction receipt'),
        h('pre', { class: 'mono', style: 'white-space:pre-wrap;margin:0' }, JSON.stringify(d.receipt || {}, null, 2))));
  }

  // Folder and retention
  const folderSel = h('select', null, h('option', { value: '' }, 'No folder'), ui.snapshot.folders.map((f) => h('option', { value: f.name }, f.name)));
  folderSel.value = d.folder || '';
  folderSel.addEventListener('change', async () => { if (await attempt(() => vault.update(d.id, { folder: folderSel.value || null }))) refresh(); });

  const ruleEditor = policyEditor(d.policy, async (policy) => {
    const save = (ack) => vault.update(d.id, { policy }, { acknowledgeShort: ack });
    try {
      await save(false);
    } catch (err) {
      if (err.code === 'below_minimum' && window.confirm(err.message)) await attempt(() => save(true));
      else if (err.code !== 'below_minimum') toast(err.message, 'error');
    }
    refresh();
  }, d.effective);

  const hold = h('input', { type: 'checkbox', id: 'hold', style: 'width:auto', checked: d.legalHold });
  hold.addEventListener('change', async () => { await attempt(() => vault.update(d.id, { legalHold: hold.checked })); refresh(); });

  const destroy = async () => {
    const ok = window.confirm(`Destroy "${nameOf(d)}" now?\n\nThe encrypted file and its key are deleted from this vault and cannot be recovered. A signed receipt is kept. Copies elsewhere (other parties, backups made earlier, exported copies) are not affected.`);
    if (ok && await attempt(() => vault.destroy(d.id))) { toast('Destroyed. A signed receipt was kept.', 'ok'); refresh(); }
  };

  const notes = h('textarea', { rows: 3, class: 'notes', placeholder: 'Private notes (encrypted): who it is with, where the original is kept…', maxlength: 2000 });
  notes.value = d.notes || '';
  const saveNotes = async () => { if ((notes.value || '') !== (d.notes || '') && await attempt(() => vault.update(d.id, { notes: notes.value }))) { toast('Notes saved.', 'ok'); refresh(); } };

  return h('div', null,
    nameHeader(d),
    h('div', { class: 'small dim' }, `${d.name} · ${fmtSize(d.size)} · added ${fmtDate(d.addedAt)}`),
    d.ids?.title && d.ids.title !== nameOf(d) ? h('div', { class: 'small dim' }, `Title on the document: ${d.ids.title}`) : null,
    proof,
    h('div', { class: 'box' },
      h('h3', null, 'Read and share'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => attempt(() => vault.view(d.id, verdictOf(d))) }, 'View'),
        h('button', { onclick: () => openExport(d, 'original') }, 'Export original…'),
        h('button', { onclick: () => openExport(d, 'pack') }, 'Verification pack…')),
      h('p', { class: 'small dim', style: 'margin:8px 0 0' }, 'View opens a read-only window that decrypts in memory only. To send the document to someone, such as an authority or a lawyer, export the original: the exact file verifies as the anchored one wherever it goes. The verification pack adds a proof sheet and instructions next to it.')),
    exportLog(d),
    h('div', { class: 'box' }, h('h3', null, 'Notes'), notes, h('button', { style: 'margin-top:8px', onclick: saveNotes }, 'Save notes')),
    h('div', { class: 'box' },
      h('h3', null, 'Folder'), folderSel,
      h('h3', { style: 'margin-top:14px' }, 'Retention'),
      h('p', { class: 'small muted', style: 'margin:0 0 6px' }, `Now: ${ruleText(d)}${d.effective?.source === 'folder' ? '. Set a rule here to override the folder.' : ''}`),
      ruleEditor,
      h('div', { class: 'row', style: 'margin-top:10px' }, hold, h('label', { for: 'hold', style: 'margin:0' }, 'Legal hold (never destroy while on)'))),
    h('div', { class: 'box' },
      h('h3', null, 'Destroy'),
      h('p', { class: 'small muted', style: 'margin:0 0 8px' }, 'Deletes the file and its key from this vault. The fingerprint on the blockchain stays; it reveals nothing about the contents.'),
      h('button', { class: 'danger', disabled: d.effective?.legalHold, onclick: destroy }, d.effective?.legalHold ? 'On legal hold' : 'Destroy now')));
}

/** The document's name, with rename. Renaming never changes the file or its proof. */
function nameHeader(d) {
  if (!ui.renaming || d.destroyedAt) {
    return h('div', { class: 'row', style: 'align-items:flex-start' },
      h('h2', { style: 'font-size:16px;flex:1;min-width:0;word-break:break-word' }, nameOf(d)),
      d.destroyedAt ? null : h('button', { class: 'link small', onclick: () => { ui.renaming = true; renderMain(); } }, 'Rename'));
  }
  const input = h('input', { value: d.label || nameOf(d), maxlength: 120, 'aria-label': 'Document name' });
  const done = async (save) => {
    if (save && !(await attempt(() => vault.update(d.id, { label: input.value })))) return;
    ui.renaming = false;
    refresh();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  setTimeout(() => { input.focus(); input.select(); }, 30);
  return h('div', null, input,
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { class: 'primary', onclick: () => done(true) }, 'Save name'),
      h('button', { onclick: () => done(false) }, 'Cancel'),
      d.label ? h('button', { class: 'link small', onclick: async () => { if (await attempt(() => vault.update(d.id, { label: null }))) { ui.renaming = false; refresh(); } } }, 'Use the default name') : null),
    h('p', { class: 'small dim', style: 'margin:6px 0 0' }, 'Only you see this name. It never changes the file, its fingerprint or its proof.'));
}

/** Copies that have left the vault (kept in the encrypted index). */
function exportLog(d) {
  const list = d.exports || [];
  if (!list.length) return null;
  return h('div', { class: 'box' },
    h('h3', null, `Shared copies (${list.length})`),
    h('p', { class: 'small dim', style: 'margin:0 0 6px' }, 'Decrypted copies that left the vault. They are outside its rules, and destroying this document does not affect them.'),
    list.slice().reverse().slice(0, 20).map((e) => h('div', { class: 'logrow' },
      h('div', { class: 'row' },
        h('b', { class: 'small' }, e.kind === 'pack' ? 'Verification pack' : 'Original file'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'small dim' }, new Date(e.at).toLocaleString())),
      e.note ? h('div', { class: 'small' }, e.note) : null,
      e.fileName ? h('div', { class: 'small dim mono' }, e.fileName) : null)),
    list.length > 20 ? h('div', { class: 'small dim' }, `and ${list.length - 20} earlier`) : null);
}

/** Export dialog for the original file or the verification pack. */
function openExport(d, kind) {
  const anchored = d.verification?.verdict === 'anchored';
  const note = h('input', { maxlength: 300, placeholder: 'e.g. Sent to HMRC, case 1234' });
  const hold = h('input', { type: 'checkbox', id: 'xhold', style: 'width:auto', checked: false, disabled: d.legalHold });
  const err = h('div', { class: 'error' });
  let close = null;
  const go = async () => {
    const fn = kind === 'pack' ? vault.exportPack : vault.exportOriginal;
    const r = await attempt(() => fn(d.id, { note: note.value || null, legalHold: hold.checked }), err);
    if (r === undefined) return;
    close();
    if (r) {
      toast(kind === 'pack' ? `Verification pack saved to ${r.path}` : `Original exported to ${r.path}`, 'ok');
      refresh();
    }
  };
  close = modal(
    h('h2', null, kind === 'pack' ? 'Create a verification pack' : 'Export the original file'),
    h('p', { class: 'muted' }, kind === 'pack'
      ? 'A ZIP with the original file, unchanged, plus a one-page verification sheet, proof.json and instructions. The vault checks the blockchain again first, so the sheet records a fresh result. The proof sits next to the PDF, never inside it.'
      : 'Saves a byte-for-byte copy of the original file. Anyone can check it at verify.immupact.com, or directly on the blockchain.'),
    anchored ? null : h('div', { class: 'note warn' }, 'This file is not the anchored file, so it will not verify as an exact match. The -FINAL.pdf downloaded when the agreement was anchored is the one to share.'),
    h('div', { class: 'note warn' }, 'The exported copy is not encrypted, and the vault\'s retention rules cannot reach it. Do not edit, re-save, compress or stamp it: any change breaks the exact match. Renaming the file is fine.'),
    h('label', null, 'Who is it for? (optional, kept in this vault\'s encrypted log)'), note,
    h('div', { class: 'row', style: 'margin-top:12px' }, hold, h('label', { for: 'xhold', style: 'margin:0' }, d.legalHold ? 'Already on legal hold' : 'Put this document on legal hold (recommended if it is going to an authority or into a dispute)')),
    err,
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'primary', onclick: go }, kind === 'pack' ? 'Create pack…' : 'Export…'),
      h('button', { onclick: () => close() }, 'Cancel')));
}

/** Retention rule editor shared by documents and folders. */
function policyEditor(current, onSave, effective) {
  const mode = h('select', null,
    h('option', { value: 'inherit' }, effective ? 'Use the folder rule / keep' : 'Keep (no rule)'),
    h('option', { value: 'keep' }, 'Keep until I delete it'),
    h('option', { value: 'destroy_on' }, 'Destroy on a date'),
    h('option', { value: 'destroy_after' }, 'Destroy after a number of days'));
  const date = h('input', { type: 'date' });
  const days = h('input', { type: 'number', min: 1, step: 1, placeholder: 'e.g. 2190 (6 years)' });
  const from = h('select', null, h('option', { value: 'added' }, 'from when it was added'), h('option', { value: 'sealed' }, 'from when it was sealed'));
  const extra = h('div');
  mode.value = current?.mode || 'inherit';
  if (current?.mode === 'destroy_on') date.value = String(current.date).slice(0, 10);
  if (current?.mode === 'destroy_after') { days.value = current.days; from.value = current.from || 'added'; }
  const show = () => {
    extra.replaceChildren();
    if (mode.value === 'destroy_on') extra.append(h('label', null, 'Date'), date);
    if (mode.value === 'destroy_after') extra.append(h('label', null, 'Days'), days, h('label', null, 'Counted'), from);
  };
  mode.addEventListener('change', show);
  show();
  const save = h('button', { style: 'margin-top:8px', onclick: () => {
    if (mode.value === 'inherit') return onSave(null);
    if (mode.value === 'keep') return onSave({ mode: 'keep' });
    if (mode.value === 'destroy_on') return date.value ? onSave({ mode: 'destroy_on', date: `${date.value}T00:00:00Z` }) : toast('Choose a date.', 'error');
    return Number(days.value) > 0 ? onSave({ mode: 'destroy_after', days: Number(days.value), from: from.value }) : toast('Enter a number of days.', 'error');
  } }, 'Save rule');
  return h('div', null, mode, extra, save);
}

// ───────────────────────────── modals

function modal(...content) {
  const back = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === back) back.remove(); } });
  back.append(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, ...content));
  document.body.append(back);
  return () => back.remove();
}

function openFolderEditor(name) {
  const existing = name ? ui.snapshot.folders.find((f) => f.name === name) : null;
  const err = h('div', { class: 'error' });
  const nameIn = h('input', { value: name || '', placeholder: 'e.g. Leases', disabled: !!name });
  const hold = h('input', { type: 'checkbox', id: 'fhold', style: 'width:auto', checked: existing?.legalHold });
  let close = null;
  const save = async (policy) => {
    const run = (ack) => vault.setFolder(nameIn.value, { policy, legalHold: hold.checked }, { acknowledgeShort: ack });
    try {
      await run(false);
    } catch (e) {
      if (e.code === 'below_minimum' && window.confirm(e.message)) { if (!(await attempt(() => run(true), err))) return; } else { err.textContent = e.message; return; }
    }
    close(); if (!name) ui.filter = { kind: 'folder', name: nameIn.value.trim() }; refresh();
  };
  close = modal(
    h('h2', null, name ? `Folder rules: ${name}` : 'New folder'),
    h('label', null, 'Name'), nameIn,
    h('label', null, 'Retention rule for documents in this folder'),
    policyEditor(existing?.policy, save),
    h('div', { class: 'row', style: 'margin-top:12px' }, hold, h('label', { for: 'fhold', style: 'margin:0' }, 'Legal hold for the whole folder')),
    err,
    name ? h('div', { class: 'row', style: 'margin-top:14px' },
      h('button', { class: 'danger', onclick: async () => { if (window.confirm(`Remove the folder "${name}"? Its documents stay in the vault.`) && await attempt(() => vault.removeFolder(name), err)) { close(); ui.filter = { kind: 'all' }; refresh(); } } }, 'Remove folder')) : null);
}

async function openReceipts() {
  const receipts = await attempt(() => vault.receipts());
  if (!receipts) return;
  modal(
    h('h2', null, 'Destruction receipts'),
    h('p', { class: 'small muted' }, 'Each receipt is signed by this vault\'s own key, so you can show when and under which rule a document was destroyed.'),
    receipts.length ? receipts.slice().reverse().map((r) => h('div', { class: 'box' },
      h('div', { class: 'row' }, h('b', null, r.displayName || r.name), h('span', { class: 'spacer' }), h('span', { class: 'small dim' }, new Date(r.destroyedAt).toLocaleString())),
      r.displayName && r.displayName !== r.name ? h('div', { class: 'small dim' }, r.name) : null,
      h('div', { class: 'small muted' }, `Reason: ${r.reason.replace(/_/g, ' ')}${r.exportedCopies ? ` · ${r.exportedCopies} shared cop${r.exportedCopies === 1 ? 'y' : 'ies'} existed outside the vault` : ''}`),
      h('div', { class: 'mono dim', style: 'margin-top:4px' }, r.fileHash)))
      : h('div', { class: 'empty' }, 'No receipts yet.'));
}

function openSettings() {
  const s = ui.settings;
  const err = h('div', { class: 'error' });
  const online = h('input', { type: 'checkbox', id: 'online', style: 'width:auto', checked: s.onlineChecks });
  const url = h('input', { value: s.immupactVerifyUrl });
  const rpcs = h('textarea', { rows: 3, style: 'width:100%;background:#080a0e;border:1px solid #1e2533;border-radius:8px;padding:8px;color:inherit', placeholder: 'Leave empty to use the standard public endpoints' });
  rpcs.value = (s.rpcs || []).join('\n');
  const watch = h('input', { type: 'checkbox', id: 'watch', style: 'width:auto', checked: s.watchEnabled });
  const lockMin = h('input', { type: 'number', min: 1, max: 240, value: s.autoLockMinutes });
  const protect = h('input', { type: 'checkbox', id: 'protect', style: 'width:auto', checked: s.protectViewer });
  const minDays = h('input', { type: 'number', min: 0, value: ui.snapshot?.minRetentionDays ?? 2190 });
  const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
  let close = null;
  const save = async () => {
    const next = await attempt(() => vault.setSettings({
      onlineChecks: online.checked, immupactVerifyUrl: url.value, rpcs: rpcs.value.split(/\s+/).filter(Boolean),
      watchEnabled: watch.checked, autoLockMinutes: lockMin.value, protectViewer: protect.checked,
    }), err);
    if (!next) return;
    if (!(await attempt(() => vault.setMinRetentionDays(minDays.value), err))) return;
    if (p1.value || p2.value) {
      if (p1.value !== p2.value) { err.textContent = 'The two new passphrases do not match.'; return; }
      if (!(await attempt(() => vault.changePassphrase(p1.value), err))) return;
      toast('Passphrase changed.', 'ok');
    }
    ui.settings = next; close(); refresh();
  };
  close = modal(
    h('h2', null, 'Settings'),
    h('div', { class: 'box' },
      h('h3', null, 'Online wording check (optional)'),
      h('div', { class: 'row' }, online, h('label', { for: 'online', style: 'margin:0' }, 'Allow asking ImmuPact to confirm the wording of copies that are not the anchored file')),
      h('p', { class: 'small dim' }, 'Only fingerprints are sent, never the file. Verifying anchored files never needs this: it talks to the blockchain directly.'),
      h('label', null, 'ImmuPact verify address'), url),
    h('div', { class: 'box' }, h('h3', null, 'Blockchain endpoints'), rpcs),
    h('div', { class: 'box' },
      h('h3', null, 'Convenience'),
      h('div', { class: 'row' }, watch, h('label', { for: 'watch', style: 'margin:0' }, 'Offer to add new -FINAL.pdf files that appear in Downloads')),
      h('label', null, 'Lock after this many idle minutes'), lockMin),
    h('div', { class: 'box' },
      h('h3', null, 'Viewer privacy'),
      h('div', { class: 'row' }, protect, h('label', { for: 'protect', style: 'margin:0' }, 'Hide document windows from screenshots and screen sharing')),
      h('p', { class: 'small dim' }, 'Works on macOS and Windows. Applies to documents opened after you save.')),
    h('div', { class: 'box' },
      h('h3', null, 'Retention safety'),
      h('label', null, 'Minimum retention in days (rules shorter than this need confirmation)'), minDays,
      h('p', { class: 'small dim' }, 'Default 2190 days (6 years), the usual UK limitation period for simple contracts. Deeds are often 12 years.')),
    h('div', { class: 'box' },
      h('h3', null, 'Change passphrase'),
      h('label', null, 'New passphrase'), p1, h('label', null, 'Repeat new passphrase'), p2),
    err,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: save }, 'Save'), h('button', { onclick: () => close() }, 'Cancel')));
}

// ───────────────────────────── events from the main process

vault.on('vault:locked', ({ reason }) => {
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
  const why = { idle: 'Locked after a period of inactivity.', sleep: 'Locked because the computer went to sleep.', 'screen-lock': 'Locked because the screen was locked.' }[reason] || 'Locked.';
  viewUnlock(why);
});
vault.on('vault:destroyed', (items) => {
  for (const i of items) toast(`Retention rule: "${i.name}" was destroyed. A signed receipt was kept.`);
  if (ui.snapshot) refresh();
});
vault.on('watch:found', ({ path, name }) => {
  if (!ui.snapshot) return;
  toast(`New final PDF in Downloads: ${name}.`, '', { label: 'Add to vault', run: () => importPaths([path]) });
});

boot().catch((err) => mount(h('div', { class: 'center' }, h('div', { class: 'card' }, brand(), h('p', { class: 'error' }, err.message)))));
