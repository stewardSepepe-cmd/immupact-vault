'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Settings, DEFAULTS } = require('../src/main/settings');

test('the verify address defaults to the ImmuPact domain', () => {
  assert.equal(DEFAULTS.immupactVerifyUrl, 'https://immupact.com/functions/publicVerify');
});

test('a saved legacy address moves to the ImmuPact domain; a custom one is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipv-set-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ immupactVerifyUrl: 'https://lock-chain-fcabd170.base44.app/functions/publicVerify' }));
  assert.equal(new Settings(dir).get('immupactVerifyUrl'), DEFAULTS.immupactVerifyUrl);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ immupactVerifyUrl: 'https://example.org/verify' }));
  assert.equal(new Settings(dir).get('immupactVerifyUrl'), 'https://example.org/verify');
});
