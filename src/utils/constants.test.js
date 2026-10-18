import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateProgressiveTax, progressiveTaxBrackets } from './constants.js';

const owed = (income, country, status = 'single') => calculateProgressiveTax(income, country, status).owed;
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test('Moroccan 2026 exemption and progressive tax totals use MAD thresholds', () => {
  for (const [income, tax] of [[0, 0], [40000, 0], [60000, 2000], [80000, 6000], [100000, 12000], [180000, 39200], [200000, 46600]]) {
    closeTo(owed(income, 'MA'), tax);
  }
});

test('US 2026 single-filer tax totals include the 37% top bracket', () => {
  for (const [income, tax] of [[12400, 1240], [50400, 5800], [105700, 17966], [201775, 41024], [256225, 58448], [640600, 192979.25], [700000, 214957.25]]) {
    closeTo(owed(income, 'US'), tax);
  }
});

test('US joint filing uses the corresponding 2026 schedule', () => {
  closeTo(owed(24800, 'US', 'married'), 2480);
  closeTo(owed(100800, 'US', 'married'), 11600);
  closeTo(owed(768700 + 100, 'US', 'married') - owed(768700, 'US', 'married'), 37);
  assert.ok(owed(100800, 'US', 'married') < owed(100800, 'US'));
});

test('joint filing cannot change Moroccan or UK tax calculations', () => {
  for (const country of ['MA', 'UK']) {
    assert.deepEqual(calculateProgressiveTax(150000, country, 'married'), calculateProgressiveTax(150000, country, 'single'));
  }
});

test('UK allowance tapers above £100,000 and is exhausted at £125,140', () => {
  for (const [income, tax] of [[12570, 0], [50270, 7540], [100000, 27432], [110000, 33432], [125140, 42516], [150000, 53703]]) {
    closeTo(owed(income, 'UK'), tax);
  }
  const tapered = calculateProgressiveTax(110000, 'UK');
  assert.equal(tapered.breakdown[0].amountTaxed, 7570);
  assert.equal(tapered.breakdown[1].amountTaxed, 37700);
  closeTo(owed(100002, 'UK') - owed(100000, 'UK'), 1.2);
  closeTo(owed(125142, 'UK') - owed(125140, 'UK'), 0.9);
});

test('every bracket boundary applies the next marginal rate without gaps', () => {
  for (const [key, brackets] of Object.entries(progressiveTaxBrackets)) {
    const country = key === 'US_married' ? 'US' : key;
    const status = key === 'US_married' ? 'married' : 'single';
    for (let index = 1; index < brackets.length; index++) {
      const threshold = brackets[index].min;
      assert.equal(brackets[index - 1].max, threshold);
      const rate = country === 'UK' && threshold === 125140 ? 0.45 : brackets[index].rate;
      closeTo(owed(threshold + 1, country, status) - owed(threshold, country, status), rate);
    }
  }
});

test('calculations preserve bracket tables and reconcile totals with their breakdown', () => {
  const original = structuredClone(progressiveTaxBrackets);
  for (const country of ['MA', 'US', 'UK']) {
    for (const income of [0, 50000, 110000, 125140, 800000]) {
      const result = calculateProgressiveTax(income, country, 'single');
      closeTo(result.breakdown.reduce((sum, row) => sum + row.taxResult, 0), result.owed);
      closeTo(result.net + result.owed, income);
      closeTo(result.breakdown.reduce((sum, row) => sum + row.amountTaxed, 0), income);
    }
  }
  assert.deepEqual(progressiveTaxBrackets, original);
});
