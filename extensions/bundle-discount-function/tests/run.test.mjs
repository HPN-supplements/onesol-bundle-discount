import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../src/run.js';

const PROMO = { 1: 15, 2: 20, 3: 25, 4: 30 };
const CONFIG = {
  defaultTiers: { 2: 15, 3: 20, 4: 25 },
  schedule: [
    { start: '2026-10-28', end: '2026-11-01', tiers: PROMO },
    { start: '2026-11-02', end: null, tiers: PROMO },
  ],
};

function input(qty, { config, date } = {}) {
  return {
    cart: {
      lines: [
        {
          id: 'gid://shopify/CartLine/1',
          quantity: qty,
          cost: { subtotalAmount: { amount: String(qty * 100) } },
          bundleItem: { value: 'true' },
          bundleId: { value: 'bb-1' },
        },
      ],
    },
    discount: { discountClasses: ['PRODUCT'], config: config === undefined ? null : { jsonValue: config } },
    shop: { localTime: { date: date ?? '2026-10-27' } },
  };
}

function pct(qty, opts) {
  const ops = run(input(qty, opts)).operations;
  if (!ops.length) return 0;
  const c = ops[0].productDiscountsAdd.candidates[0];
  assert.equal(c.message, 'Bundle ' + c.message.match(/\d+/)[0] + '% off');
  return Number(c.message.match(/\d+/)[0]);
}

test('no config keeps the hardcoded defaults', () => {
  assert.deepEqual([1, 2, 3, 4, 7].map((q) => pct(q)), [0, 15, 20, 25, 25]);
});

test('no shop date keeps defaults', () => {
  const i = input(2, { config: CONFIG });
  delete i.shop;
  assert.equal(run(i).operations[0].productDiscountsAdd.candidates[0].message, 'Bundle 15% off');
});

test('before the promo window uses default tiers', () => {
  assert.deepEqual([1, 2, 3, 4].map((q) => pct(q, { config: CONFIG, date: '2026-10-27' })), [0, 15, 20, 25]);
});

test('promo window: 1 item gets 15%, 4+ gets 30%', () => {
  for (const date of ['2026-10-28', '2026-10-31']) {
    assert.deepEqual([1, 2, 3, 4, 5].map((q) => pct(q, { config: CONFIG, date })), [15, 20, 25, 30, 30]);
  }
});

test('end date is exclusive: 2026-11-01 is default again', () => {
  assert.deepEqual([1, 2, 3, 4].map((q) => pct(q, { config: CONFIG, date: '2026-11-01' })), [0, 15, 20, 25]);
});

test('open-ended window applies from its start with no end', () => {
  assert.equal(pct(1, { config: CONFIG, date: '2026-11-02' }), 15);
  assert.equal(pct(1, { config: CONFIG, date: '2027-06-01' }), 15);
});

test('config can arrive as a JSON string', () => {
  assert.equal(pct(1, { config: JSON.stringify(CONFIG), date: '2026-10-29' }), 15);
});

test('bad config falls back to defaults without throwing', () => {
  const bad = ['{not json', 42, [], {}, { schedule: 'x' }, { defaultTiers: { a: 'b' }, schedule: [null, { start: 1 }] },
    { schedule: [{ start: '2026-10-27', end: null, tiers: { 1: 'x' } }] }];
  for (const config of bad) {
    assert.deepEqual([1, 2, 3, 4].map((q) => pct(q, { config, date: '2026-10-27' })), [0, 15, 20, 25]);
  }
});

test('custom defaultTiers are honored', () => {
  assert.equal(pct(2, { config: { defaultTiers: { 2: 10 } } }), 10);
});

test('banner/title keys in the shared schedule JSON are ignored', () => {
  const config = JSON.parse(readFileSync(new URL('../../../bundle-schedule.onesol.json', import.meta.url), 'utf8'));
  assert.deepEqual([1, 2, 3, 4].map((q) => pct(q, { config, date: '2026-10-29' })), [15, 20, 25, 30]);
  assert.deepEqual([1, 2, 3, 4].map((q) => pct(q, { config, date: '2026-11-01' })), [0, 15, 20, 25]);
  assert.deepEqual([1, 2, 3, 4].map((q) => pct(q, { config, date: '2026-11-02' })), [15, 20, 25, 30]);
});
