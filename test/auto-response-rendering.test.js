const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');

test('auto responses replace their predecessor and omit the user bubble', () => {
  assert.match(renderer, /if \(auto\) \{[\s\S]*?querySelector\('\.response-group\.auto-response'\)[\s\S]*?previousAuto\.remove\(\)/);
  assert.match(renderer, /if \(auto\) group\.classList\.add\('auto-response'\)/);
  assert.match(renderer, /if \(!auto && userBubble\) \{/);
});
