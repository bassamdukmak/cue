const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldScheduleAutoSuggest, resetAutoSuggestTrigger } = require('../src/auto-suggest-trigger');

test('uses mic turns only until meeting audio arrives', () => {
  resetAutoSuggestTrigger();
  assert.equal(shouldScheduleAutoSuggest('you'), true);
  assert.equal(shouldScheduleAutoSuggest('them'), true);
  assert.equal(shouldScheduleAutoSuggest('you'), false);
  assert.equal(shouldScheduleAutoSuggest('them'), true);
});
