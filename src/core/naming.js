'use strict';
// Names shown for documents. The file name and the ImmuPact title never change (the title is part
// of the sealed fingerprint); the label is the owner's own name for the document and can change
// at any time. None of this affects verification, which only looks at the file's bytes.

const MAX_LABEL = 120;

/** "acme-lease-renewal_6ae9c2b3-FINAL.pdf" -> "acme-lease-renewal" (id and suffix removed). */
function fileStem(fileName) {
  return String(fileName || '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/-FINAL$/i, '')
    .replace(/[_-][0-9a-f]{6,24}$/i, '')
    .trim();
}

const comparable = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function humanise(stem) {
  const s = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/**
 * The name a document gets when it is added:
 *  - a file the owner named themselves (e.g. saved under their ImmuPact label) keeps that name;
 *  - otherwise the agreement title printed on the PDF;
 *  - otherwise the file name.
 */
function defaultDisplayName(doc) {
  const title = doc?.ids?.title || '';
  const stem = fileStem(doc?.name);
  const generic = !stem || /^immupact[_ -]/i.test(stem) || comparable(stem) === comparable(title);
  if (!generic) return humanise(stem).slice(0, MAX_LABEL);
  return (title || humanise(stem) || doc?.name || 'Document').slice(0, MAX_LABEL);
}

function displayName(doc) {
  return (doc?.label && String(doc.label).trim()) || defaultDisplayName(doc);
}

function cleanLabel(label) {
  if (label === null || label === undefined) return null;
  const s = String(label).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > MAX_LABEL) throw new Error(`Keep the name under ${MAX_LABEL} characters.`);
  return s;
}

/** Text the search box matches against. */
function searchText(doc) {
  return [displayName(doc), doc?.name, doc?.ids?.title, doc?.notes, doc?.folder, doc?.ids?.contractId]
    .filter(Boolean).join(' ').toLowerCase();
}

/** A safe file name for exports (no path characters, keeps the extension). */
function safeFileName(name, ext) {
  const base = String(name || 'document').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'document';
  return ext ? `${base}${ext}` : base;
}

module.exports = { MAX_LABEL, fileStem, defaultDisplayName, displayName, cleanLabel, searchText, safeFileName };
