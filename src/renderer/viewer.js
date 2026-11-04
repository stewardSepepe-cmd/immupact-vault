// Read-only document viewer. Renders the PDF itself with pdf.js (bundled locally, no network),
// on the page's own thread: no worker, no text layer, no annotations, no forms, no scripts.
/* global viewerBridge */

import * as pdfjs from '../../node_modules/pdfjs-dist/build/pdf.min.mjs';
import * as pdfWorker from '../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs';

// Use pdf.js's in-page worker instead of loading a separate worker file.
globalThis.pdfjsWorker = pdfWorker;

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const state = { doc: null, zoom: 'fit', scale: 1, pages: [], renderToken: 0 };

function setHeader(info) {
  $('name').textContent = info.displayName || info.name;
  $('sub').textContent = info.displayName && info.displayName !== info.name ? info.name : '';
  const b = $('badge');
  b.className = `badge ${info.verdict?.cls || 'grey'}`;
  b.textContent = info.verdict?.label || 'Not checked';
  $('verdict').textContent = info.verdict?.text || '';
  document.title = `${info.displayName || info.name} · ImmuPact Vault`;
}

function message(text) {
  stage.replaceChildren(Object.assign(document.createElement('div'), { className: 'vmsg', textContent: text }));
}

// ───────────────────────────── PDF

async function openPdf(bytes) {
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,      // never compile code from fonts
    enableXfa: false,            // no XFA forms
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  state.doc = await task.promise;
  $('pages').textContent = `${state.doc.numPages} page${state.doc.numPages === 1 ? '' : 's'}`;
  const sizes = [];
  for (let i = 1; i <= state.doc.numPages; i++) {
    const page = await state.doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ page, w: vp.width, h: vp.height });
  }
  state.pages = sizes;
  layout();
}

function fitScale() {
  const maxW = Math.max(...state.pages.map((p) => p.w));
  return Math.max(0.25, (stage.clientWidth - 40) / maxW);
}

let observer = null;
function layout() {
  state.scale = state.zoom === 'fit' ? fitScale() : state.zoom;
  const token = ++state.renderToken;
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) renderPage(e.target, token);
  }, { root: stage, rootMargin: '600px 0px' });
  const nodes = state.pages.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'vpage';
    el.dataset.index = String(i);
    el.style.width = `${Math.floor(p.w * state.scale)}px`;
    el.style.height = `${Math.floor(p.h * state.scale)}px`;
    const num = document.createElement('span');
    num.className = 'vnum';
    num.textContent = `${i + 1} / ${state.pages.length}`;
    el.append(num);
    return el;
  });
  stage.replaceChildren(...nodes);
  nodes.forEach((n) => observer.observe(n));
}

async function renderPage(el, token) {
  if (el.dataset.rendered === String(token)) return;
  el.dataset.rendered = String(token);
  const { page } = state.pages[Number(el.dataset.index)];
  const dpr = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: state.scale * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  try {
    // Annotations (links, form fields) are not drawn interactively and nothing on the page can be clicked.
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  } catch (err) {
    if (token !== state.renderToken) return;
    canvas.getContext('2d').fillText('This page could not be drawn.', 20, 30);
  }
  if (token !== state.renderToken) return;
  el.querySelector('canvas')?.remove();
  el.prepend(canvas);
}

// ───────────────────────────── images

function openImage(bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const img = document.createElement('img');
  img.className = 'vimg';
  img.alt = '';
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  stage.replaceChildren(img);
  $('pages').textContent = '';
  for (const id of ['zoomOut', 'fit', 'zoomIn']) $(id).hidden = true;
}

// ───────────────────────────── controls

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
function zoom(dir) {
  if (!state.pages.length) return;
  const cur = state.zoom === 'fit' ? state.scale : state.zoom;
  const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) : [...ZOOMS].reverse().find((z) => z < cur - 0.01);
  if (next) { state.zoom = next; layout(); }
}
$('zoomIn').addEventListener('click', () => zoom(1));
$('zoomOut').addEventListener('click', () => zoom(-1));
$('fit').addEventListener('click', () => { state.zoom = 'fit'; layout(); });
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (state.zoom !== 'fit' || !state.pages.length) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 150);
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoom(1); }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoom(-1); }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); state.zoom = 'fit'; layout(); }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());

// ───────────────────────────── start

(async () => {
  try {
    const info = await viewerBridge.load();
    setHeader(info);
    const bytes = new Uint8Array(info.bytes);
    if (info.mime === 'application/pdf') await openPdf(bytes);
    else if (info.mime.startsWith('image/')) openImage(bytes, info.mime);
    else message('This type of file cannot be shown here. Use "Export original" in the vault to open it in another app.');
  } catch (err) {
    message(err.message || 'The document could not be opened.');
  }
})();
