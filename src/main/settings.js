'use strict';
// App settings (not secret): where the vault lives, which blockchain endpoints to use, whether
// online checks are allowed. Stored as plain JSON in the app's user-data folder.

const fs = require('fs');
const path = require('path');

// Earlier builds saved the platform's internal address. Installs that still hold it move to the
// ImmuPact domain on start; an address the user typed themselves is left alone.
const LEGACY_VERIFY_URLS = ['https://lock-chain-fcabd170.base44.app/functions/publicVerify'];

const DEFAULTS = {
  vaultDir: null,
  network: 'sepolia',
  rpcs: [],                 // empty = the standard's public endpoints
  onlineChecks: false,      // the optional ImmuPact wording check is OFF unless you turn it on
  immupactVerifyUrl: 'https://immupact.com/functions/publicVerify',
  watchEnabled: true,       // offer to import new *-FINAL.pdf files that appear in the watch folder
  watchDir: null,           // default: the Downloads folder
  autoLockMinutes: 10,
  protectViewer: false,     // hide document windows from screenshots and screen sharing (macOS, Windows)
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.values = { ...DEFAULTS };
    try {
      this.values = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch { /* first run */ }
    if (LEGACY_VERIFY_URLS.includes(this.values.immupactVerifyUrl)) this.values.immupactVerifyUrl = DEFAULTS.immupactVerifyUrl;
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values };
  }

  set(patch) {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS)) continue;
      if (k === 'rpcs') clean.rpcs = (Array.isArray(v) ? v : []).map(String).filter((u) => /^https:\/\//.test(u)).slice(0, 10);
      else if (k === 'immupactVerifyUrl') { if (/^https:\/\//.test(String(v))) clean[k] = String(v); }
      else if (k === 'autoLockMinutes') clean[k] = Math.min(240, Math.max(1, Math.floor(Number(v) || 10)));
      else if (k === 'onlineChecks' || k === 'watchEnabled' || k === 'protectViewer') clean[k] = !!v;
      else clean[k] = v;
    }
    this.values = { ...this.values, ...clean };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    return this.all();
  }
}

module.exports = { Settings, DEFAULTS };
