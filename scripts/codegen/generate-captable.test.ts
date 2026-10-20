import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverRecordTypes, orderRecordTypes } from './generate-captable';

void test('keeps the committed constructor order, not the file order', () => {
  assert.deepEqual(orderRecordTypes(['Zeta', 'Alpha', 'Mid'], ['Mid', 'Zeta', 'Alpha']), ['Mid', 'Zeta', 'Alpha']);
});

void test('refuses a template that is not in the order, asking for it to be appended', () => {
  assert.throws(
    () => orderRecordTypes(['Alpha', 'Beta', 'New'], ['Alpha', 'Beta']),
    /OCF\/New\.daml is not in.*append/
  );
});

void test('refuses an entry whose template is gone, since a constructor never leaves', () => {
  assert.throws(() => orderRecordTypes(['Alpha'], ['Alpha', 'Beta']), /lists Beta with no OCF/);
});

void test('refuses an entry listed twice', () => {
  assert.throws(() => orderRecordTypes(['Alpha', 'Beta'], ['Alpha', 'Beta', 'Alpha']), /lists Alpha twice/);
});

void test('the committed order lists every OCF template once, and each follows the naming rule', () => {
  const types = discoverRecordTypes();
  assert.equal(new Set(types.map((t) => t.name)).size, types.length);
  assert.ok(types.length > 0);
});
