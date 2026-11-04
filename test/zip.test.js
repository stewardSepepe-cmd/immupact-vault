'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildZip, readZip, crc32 } = require('../src/core/zip');

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('a ZIP round-trips its files byte for byte', () => {
  const pdf = crypto.randomBytes(5000);
  const zip = buildZip([
    { name: 'Pack/Letter – café.pdf', data: pdf },
    { name: 'Pack/proof.json', data: '{"a":1}\n' },
  ]);
  const files = readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ['Pack/Letter – café.pdf', 'Pack/proof.json']);
  assert.ok(files[0].data.equals(pdf));
  assert.equal(files[1].data.toString(), '{"a":1}\n');
});

test('refuses unsafe or duplicate names', () => {
  assert.throws(() => buildZip([{ name: '../evil', data: 'x' }]), /Bad or duplicate/);
  assert.throws(() => buildZip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]), /Bad or duplicate/);
});
