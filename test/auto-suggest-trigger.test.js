const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldScheduleAutoSuggest, resetAutoSuggestTrigger } = require('../src/auto-suggest-trigger');
const fs = require('node:fs');
const path = require('node:path');

test('uses mic turns only until meeting audio arrives', () => {
  resetAutoSuggestTrigger();
  assert.equal(shouldScheduleAutoSuggest('you'), true);
  assert.equal(shouldScheduleAutoSuggest('them'), true);
  assert.equal(shouldScheduleAutoSuggest('you'), false);
  assert.equal(shouldScheduleAutoSuggest('them'), true);
});

test('a new capture session restores the mic-only fallback after a them turn', () => {
  resetAutoSuggestTrigger();
  assert.equal(shouldScheduleAutoSuggest('them'), true);
  resetAutoSuggestTrigger();
  assert.equal(shouldScheduleAutoSuggest('you'), true);
});

test('capture start resets both auto-suggest session flags', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf('async function setCapturing(active)');
  const activeBranch = source.slice(start, source.indexOf('\n  }\n\n  state.capturing = false;', start));
  assert.match(activeBranch, /resetAutoSuggestTrigger\(\)/);
  assert.match(activeBranch, /soloFallbackAnnounced = false/);
});
