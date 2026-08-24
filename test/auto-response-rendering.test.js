const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

test('auto and action responses replace the single ephemeral answer and omit the user bubble', () => {
  assert.match(renderer, /const liveAnswer = auto \|\| ephemeral;/);
  assert.match(renderer, /ephemeralAnswerContent\.querySelector\('\.response-group\.auto-response'\)[\s\S]*?previousAuto\.remove\(\)/);
  assert.match(renderer, /if \(liveAnswer\) group\.classList\.add\('auto-response', 'ephemeral-response'\)/);
  assert.match(renderer, /if \(!liveAnswer && userBubble\) \{/);
  assert.match(renderer, /#pin-answer-btn.*pinEphemeralAnswer/);
});

test('action chips render in both surfaces and remain clickable in the overlay', () => {
  assert.match(html, /id="ephemeral-answer"[\s\S]*id="pin-answer-btn"[\s\S]*id="action-strip"/);
  assert.match(renderer, /const hosts = \[\$\('#action-strip'\), \$\('#actions-list'\)\]/);
  assert.match(renderer, /cue\.actionInvoke\(action\.id, action\.kind, action\.payload\)/);
  assert.match(renderer, /#ephemeral-answer, #action-strip/);
  assert.match(css, /#ephemeral-answer, #action-strip, #action-row/);
});
