'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/core/retention');

const DAY = 86400000;
const now = Date.parse('2026-11-03T12:00:00Z');
const doc = (over = {}) => ({ id: 'd', blobId: 'b'.repeat(24), addedAt: '2026-01-01T00:00:00Z', ...over });

test('document rule beats folder rule beats default keep', () => {
  const folders = { Leases: { policy: { mode: 'destroy_after', days: 3650 } } };
  assert.equal(R.effectivePolicy(doc(), folders).policy.mode, 'keep');
  assert.equal(R.effectivePolicy(doc({ folder: 'Leases' }), folders).source, 'folder');
  assert.equal(R.effectivePolicy(doc({ folder: 'Leases', policy: { mode: 'keep' } }), folders).source, 'document');
});

test('due dates', () => {
  assert.equal(R.dueDate(doc(), { mode: 'keep' }), null);
  assert.equal(R.dueDate(doc(), { mode: 'destroy_after', days: 10, from: 'added' }), '2026-01-11T00:00:00.000Z');
  assert.equal(R.dueDate(doc({ sealedAt: '2026-02-01T00:00:00Z' }), { mode: 'destroy_after', days: 1, from: 'sealed' }), '2026-02-02T00:00:00.000Z');
});

test('rules below the minimum retention need acknowledgement', () => {
  const d = doc({ addedAt: new Date(now).toISOString() });
  assert.throws(() => R.validatePolicy({ mode: 'destroy_after', days: 30 }, d, { minDays: 2190, now }), (e) => e.code === 'below_minimum');
  assert.equal(R.validatePolicy({ mode: 'destroy_after', days: 30 }, d, { minDays: 2190, acknowledgeShort: true, now }).days, 30);
  assert.equal(R.validatePolicy({ mode: 'destroy_after', days: 2200 }, d, { minDays: 2190, now }).days, 2200);
});

test('legal hold blocks destruction and keeps the file off the schedule', () => {
  const due = doc({ policy: { mode: 'destroy_on', date: '2026-06-01' } });
  assert.equal(R.dueForDestruction([due], {}, now).length, 1);
  assert.equal(R.dueForDestruction([{ ...due, legalHold: true }], {}, now).length, 0);
  assert.equal(R.dueForDestruction([{ ...due, folder: 'F' }], { F: { legalHold: true } }, now).length, 0);
  assert.deepEqual(Object.keys(R.buildSchedule([due, { ...due, blobId: 'c'.repeat(24), legalHold: true }], {})), ['b'.repeat(24)]);
  assert.equal(R.dueForDestruction([doc({ policy: { mode: 'destroy_on', date: new Date(now + DAY).toISOString() } })], {}, now).length, 0);
});
