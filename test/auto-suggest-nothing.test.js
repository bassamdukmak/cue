const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const nothingPattern = eval(rendererSource.match(/const AUTO_NOTHING_RESPONSE = (\/.*?\/i);/)[1]);
const isNothing = (raw) => !/^\s*SAY:/mi.test(raw) && nothingPattern.test(raw.slice(0, 200));

test('auto-suggest nothing detector catches silent attack replies but preserves SAY challenges', () => {
  for (const raw of [
    'Nothing recent worth challenging.',
    'No substantive claim in transcript.',
    'Silence is fine.',
  ]) assert.equal(isNothing(raw), true, raw);

  assert.equal(isNothing('SAY: What evidence supports that?\nNOTE: Nothing recent was proved.'), false);
});
