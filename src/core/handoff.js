'use strict';
// "Save to Vault" hand-off from ImmuPact.
//
// ImmuPact never sends a document to the Vault. The browser downloads the file as usual, then
// opens a link such as:
//   immupact-vault://import?v=1&ref=6ae9c2b337b2ee2852ff8f22&name=acme-lease_6ae9c2b3-FINAL.pdf
// The Vault looks for that document in the watch folder (Downloads), confirms that the PDF really
// carries that ImmuPact document ID, and asks the user before adding it.
//
// Any website can open an immupact-vault:// link, so the link is treated as untrusted: it can only
// name a document ID and a file name, never a path; the Vault only looks inside the watch folder;
// and nothing is imported without the user's confirmation.

const fs = require('fs');
const path = require('path');

const REF_RE = /^[0-9a-f]{24}$/;
const MAX_CANDIDATES = 20;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Parses and validates a hand-off link. Returns { ref, name } or null. */
function parseHandoffUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'immupact-vault:') return null;
  // "immupact-vault://import?..." puts "import" in the host; accept "immupact-vault:import?..." too.
  const action = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase().replace(/\/+$/, '');
  if (action !== 'import') return null;
  const ref = String(u.searchParams.get('ref') || '').toLowerCase();
  if (!REF_RE.test(ref)) return null;
  const rawName = u.searchParams.get('name');
  // Only a plain file name is kept: no folders, no hidden files, PDF only.
  const name = rawName && path.basename(rawName) === rawName && /^[^.\\/][^\\/]{0,200}\.pdf$/i.test(rawName) && !/[\u0000-\u001f]/.test(rawName)
    ? rawName : null;
  return { ref, name };
}

/** Finds a hand-off link among command-line arguments (Windows and Linux pass it there). */
function handoffFromArgv(argv) {
  const hit = (argv || []).find((a) => /^immupact-vault:/i.test(String(a)));
  return hit ? parseHandoffUrl(hit) : null;
}

/**
 * Looks in `dir` for the document a hand-off asks for. Candidates are recent PDFs whose name is the
 * requested name, or contains the short document ID; each is then opened and kept only if its
 * printed ImmuPact document ID equals `ref`. Newest first, -FINAL files before other copies.
 * `inspect(bytes)` reads the identifiers (src/core/pdf.js inspectPdf).
 */
async function findHandoffFile(dir, { ref, name }, { inspect, now = Date.now() } = {}) {
  if (!dir || !REF_RE.test(String(ref || ''))) return [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const short = ref.slice(0, 8);
  const candidates = entries
    .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
    .filter((e) => (name && e.name === name) || e.name.toLowerCase().includes(short))
    .map((e) => {
      const full = path.join(dir, e.name);
      let st = null;
      try { st = fs.statSync(full); } catch { /* vanished */ }
      return st ? { path: full, name: e.name, size: st.size, modifiedAt: st.mtimeMs } : null;
    })
    .filter((c) => c && now - c.modifiedAt <= MAX_AGE_MS && c.size > 0 && c.size <= 50 * 1024 * 1024)
    .sort((a, b) => (Number(b.name === name) - Number(a.name === name))
      || (Number(/-FINAL\.pdf$/i.test(b.name)) - Number(/-FINAL\.pdf$/i.test(a.name)))
      || (b.modifiedAt - a.modifiedAt))
    .slice(0, MAX_CANDIDATES);

  const found = [];
  for (const c of candidates) {
    try {
      const bytes = fs.readFileSync(c.path);
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') continue;
      const ids = await inspect(bytes);
      if (String(ids?.contractId || '').toLowerCase() === ref) {
        found.push({ ...c, final: /-FINAL\.pdf$/i.test(c.name), modifiedAt: new Date(c.modifiedAt).toISOString() });
      }
    } catch { /* unreadable: skip */ }
  }
  return found;
}

module.exports = { parseHandoffUrl, handoffFromArgv, findHandoffFile, REF_RE };
