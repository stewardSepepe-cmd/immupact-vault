'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/core/naming');

const doc = (name, title, label) => ({ name, ids: { title }, label });

test('default names: a name the owner chose wins, generic ImmuPact names fall back to the title', () => {
  // Old ImmuPact downloads (all look alike): use the title.
  assert.equal(N.defaultDisplayName(doc('immupact_official_letter_6ae902c4-FINAL.pdf', 'Official Letter')), 'Official Letter');
  // New downloads named from the title: still the title (keeps its capitals).
  assert.equal(N.defaultDisplayName(doc('acme-lease-renewal_6ae9c2b3-FINAL.pdf', 'Acme Lease Renewal')), 'Acme Lease Renewal');
  // Saved under the owner's private ImmuPact label: keep that label.
  assert.equal(N.defaultDisplayName(doc('flat-3-lease-landlord-copy_6ae9c2b3-FINAL.pdf', 'Lease Agreement')), 'Flat 3 lease landlord copy');
  // Not an ImmuPact file.
  assert.equal(N.defaultDisplayName(doc('scan_passport.pdf', null)), 'Scan passport');
});

test('the label overrides the default, and is cleaned', () => {
  assert.equal(N.displayName(doc('immupact_x_6ae902c4.pdf', 'Official Letter', 'Bank letter for mortgage')), 'Bank letter for mortgage');
  assert.equal(N.cleanLabel('  Two   spaces\n'), 'Two spaces');
  assert.equal(N.cleanLabel('   '), null);
  assert.throws(() => N.cleanLabel('x'.repeat(121)), /under 120/);
});

test('export file names have no path characters', () => {
  assert.equal(N.safeFileName('a/b\\c:d?"e*', '.zip'), 'a-b-c-d-e-.zip');
});
