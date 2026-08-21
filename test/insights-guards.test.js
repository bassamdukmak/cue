const test = require('node:test');
const assert = require('node:assert/strict');

// main.js pulls in electron, so it cannot be required under `node --test`. The
// two guards below are single lines whose absence is silent in production — the
// panel just stops updating — so they are pinned against the source, the same
// way the other main.js invariants in this suite are.
const mainSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');

function functionBody(name) {
  const start = mainSource.indexOf('function ' + name);
  assert.notEqual(start, -1, name + ' is missing from main.js');
  const body = mainSource.slice(start);
  return body.slice(0, body.indexOf('\n}\n'));
}

test('insights compare a monotonic counter, not the capped transcript length', () => {
  // transcript is trimmed to MAX_TRANSCRIPT_TURNS, so once the cap is reached
  // its length never changes again and a length-based guard silently stops
  // insights for the rest of the meeting.
  assert.match(functionBody('pushTranscript'), /transcriptSeq \+= 1/, 'pushTranscript does not advance the counter');
  const run = functionBody('runInsights');
  assert.match(run, /transcriptSeq === insightsLastSeq/, 'the freshness guard is not counter-based');
  assert.match(run, /transcriptSeq - insightsLastSeq < 4/, 'the four-turn delta guard is missing');
  assert.doesNotMatch(run, /transcript\.length === insights/, 'the capped length is still the guard');
});

test('insights cost limits remain bounded', () => {
  assert.match(mainSource, /const INSIGHTS_INTERVAL_MS = 60000/, 'insights interval is too frequent');
  assert.match(mainSource, /const INSIGHTS_MAX_LINES = 12/, 'insights history is too large');
  assert.match(mainSource, /const AUTO_SUGGEST_MIN_GAP_MS = 30000/, 'auto-suggest gap is too short');
  assert.match(functionBody('runInsights'), /maxTokens: 250/, 'insights output cap is missing');
});

test('a failed insights call hands its turns back to the next tick', () => {
  const run = functionBody('runInsights');
  assert.match(run, /const previousSeq = insightsLastSeq/, 'the pre-call sequence is not captured');
  assert.match(run, /insightsLastSeq = previousSeq/, 'the catch does not restore it');
});

test('a reset discards an insights run started before it', () => {
  // resetInsights fires on persona change and transcript clear; without the
  // generation check an in-flight run repaints the old persona's lines onto the
  // freshly cleared panel.
  assert.match(functionBody('resetInsights'), /insightsGeneration \+= 1/, 'reset does not bump the generation');
  const run = functionBody('runInsights');
  assert.match(run, /const generation = insightsGeneration/, 'the generation is not captured before the await');
  assert.match(run, /generation !== insightsGeneration\) return/, 'a stale result is not discarded after the await');
});

test('stopping Auto also invalidates an in-flight insights run', () => {
  assert.match(functionBody('stopInsights'), /insightsGeneration \+= 1/);
});
