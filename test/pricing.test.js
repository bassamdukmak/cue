const assert = require('node:assert/strict');
const test = require('node:test');
const { estimateCost, unpricedModels, emptyUsage, accumulateUsage } = require('../src/pricing');

test('pricing applies cached-token discounts and ignores unknown models', () => {
  const byModel = {
    'gpt-4o': { promptTokens: 1000, cachedTokens: 200, completionTokens: 100 },
    unknown: { promptTokens: 5000, cachedTokens: 0, completionTokens: 5000 },
  };
  assert.equal(estimateCost(byModel), 0.00325);
  assert.deepEqual(unpricedModels(byModel), ['unknown']);
});

test('lifetime accumulation retains a persistent, model-split shape', () => {
  const first = accumulateUsage(emptyUsage({ lifetime: true }), {
    model: 'gpt-4o-mini', promptTokens: 1000, cachedTokens: 400, completionTokens: 200
  }, { lifetime: true, now: new Date('2026-08-22T10:00:00.000Z') });
  const total = accumulateUsage(first, {
    model: 'gpt-4o-mini', promptTokens: 300, cachedTokens: 0, completionTokens: 100
  }, { lifetime: true, now: new Date('2026-08-22T11:00:00.000Z') });
  assert.deepEqual(Object.keys(total).sort(), ['byModel', 'cachedTokens', 'calls', 'completionTokens', 'costUsd', 'promptTokens', 'since']);
  assert.equal(total.since, '2026-08-22T10:00:00.000Z');
  assert.equal(total.calls, 2);
  assert.equal(total.promptTokens, 1300);
  assert.equal(total.cachedTokens, 400);
  assert.equal(total.completionTokens, 300);
  assert.equal(total.byModel['gpt-4o-mini'].calls, 2);
  assert.ok(total.costUsd > 0);
});
