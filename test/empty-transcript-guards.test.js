const fs = require('fs');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const mainSource = fs.readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');

function modeNeedsTranscript(mode) {
  const match = mainSource.match(/function modeNeedsTranscript\(mode\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'modeNeedsTranscript is missing from main.js');
  return vm.runInNewContext(`(${match[0]})`)(mode);
}

test('only conversation-driven buttons require a transcript', () => {
  for (const mode of ['say', 'followup', 'recap']) {
    assert.equal(modeNeedsTranscript(mode), true, `${mode} should not call a provider without speech`);
  }
  for (const mode of ['assist', 'ask', 'answerThis', 'leetcode']) {
    assert.equal(modeNeedsTranscript(mode), false, `${mode} has screen or typed input and may run empty`);
  }
});

test('the empty-transcript guard runs before the LLM client exists', () => {
  const runFeature = mainSource.slice(mainSource.indexOf('async function runFeature'));
  assert.ok(runFeature.indexOf('transcript.length === 0 && modeNeedsTranscript(mode)') < runFeature.indexOf('const llm = createLLM(settings)'));
});

test('automatic suggestions do not run after the transcript is cleared', () => {
  const autoSuggest = mainSource.slice(mainSource.indexOf('function scheduleAutoSuggest'));
  assert.match(autoSuggest, /if \(!transcript\.length\) return;/);
});
