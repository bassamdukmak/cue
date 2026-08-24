const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildActionsSystem, buildActionsTurn, parseActions, parseCompleteActions, isQuestionTurn } = require('../src/actions-prompts');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('parseActions accepts valid action lines and caps the result', () => {
  assert.deepEqual(parseActions([
    'ACTION: answer | Answer this | What is the timeline?',
    'ACTION: define | Define term | CAC payback',
    'ACTION: screen | Look at screen | As you can see, these numbers changed.',
    'ACTION: challenge | Check claim | We doubled revenue.',
    'ACTION: say | Speak now | They asked for your view.',
  ].join('\n')), [
    { kind: 'answer', label: 'Answer this', payload: 'What is the timeline?' },
    { kind: 'define', label: 'Define term', payload: 'CAC payback' },
    { kind: 'screen', label: 'Look at screen', payload: 'As you can see, these numbers changed.' },
  ]);
});

test('parseActions drops malformed lines and accepts an empty reply', () => {
  assert.deepEqual(parseActions('ACTION: answer | seven label words are too many here | What now?\nACTION: nope | Bad | payload\nhello'), []);
  assert.deepEqual(parseActions(''), []);
});

test('incremental action parser emits complete lines and ignores partial lines', () => {
  assert.deepEqual(parseCompleteActions('ACTION: answer | Answer now | What is the plan?'), []);
  assert.deepEqual(parseCompleteActions('ACTION: answer | Answer now | What is the plan?\nACTION: define | Define'), [
    { kind: 'answer', label: 'Answer now', payload: 'What is the plan?' },
  ]);
});

test('question fast path recognizes questions without false positives', () => {
  for (const text of ['What is the timeline', 'could we ship Friday', 'This ends in a question?']) assert.equal(isQuestionTurn(text), true, text);
  for (const text of ['Whatever we decide is fine', 'Canary deployment is green', 'They stated the timeline']) assert.equal(isQuestionTurn(text), false, text);
});

test('action prompts require verbatim payloads and use only recent turns', () => {
  assert.match(buildActionsSystem('attack'), /payload.*verbatim.*transcript/i);
  const turn = buildActionsTurn(Array.from({ length: 10 }, (_, i) => ({ channel: 'them', text: `turn ${i}` })));
  assert.doesNotMatch(turn, /turn 1\b/);
  assert.match(turn, /turn 2\b/);
});

test('automatic actions are fast, replace the list, and invoke explicit modes', () => {
  assert.match(mainSource, /forceTier: 'fast'/);
  assert.match(mainSource, /maxTokens: 150/);
  assert.match(mainSource, /const actions = parseActions\(reply\)/);
  assert.match(mainSource, /if \(actions\.length \|\| partialActionCount\) sendActions\(actions, 'final'\)/);
  assert.match(mainSource, /ipcMain\.on\('action:invoke'/);
  assert.match(mainSource, /answer: \['answerThis', payload\]/);
  assert.match(mainSource, /define: \['answerThis', 'Define: ' \+ payload\]/);
  assert.match(mainSource, /challenge: \['answerThis', payload\]/);
  assert.match(mainSource, /screen: \['assist', ''\]/);
  assert.match(mainSource, /say: \['say', ''\]/);
  assert.match(mainSource, /recap: \['recap', ''\]/);
  assert.match(mainSource, /async function runFeature\(mode, userText, auto = false, ephemeral = false\)/);
  assert.match(mainSource, /send\('llm:start', \{ userBubble, small: !!def\.small, category, auto, ephemeral \}\)/);
  assert.match(mainSource, /runFeature\(action\[0\], action\[1\], false, true\)\.finally\(scheduleAutoSuggest\)/);
});

test('chip scheduling has its own gap and empty results do not clear chips', () => {
  const scheduleStart = mainSource.indexOf('function scheduleAutoSuggest');
  const scheduleEnd = mainSource.indexOf('// -------- session usage', scheduleStart);
  const schedule = mainSource.slice(scheduleStart, scheduleEnd);
  assert.match(mainSource, /const ACTIONS_MIN_GAP_MS = 6000/);
  assert.match(mainSource, /const ACTIONS_QUIET_MS = 900/);
  assert.match(mainSource, /const ACTIONS_FAST_MIN_GAP_MS = 2000/);
  assert.match(schedule, /startActions\(ACTIONS_MIN_GAP_MS, turnPublishedAt\)/);
  assert.match(schedule, /startActions\(ACTIONS_FAST_MIN_GAP_MS, turnPublishedAt\)/);
  assert.doesNotMatch(schedule, /AUTO_SUGGEST_MIN_GAP_MS/);

  const runStart = mainSource.indexOf('async function runActions');
  const runEnd = mainSource.indexOf('// -------- live insights panel', runStart);
  const run = mainSource.slice(runStart, runEnd);
  assert.match(run, /parseCompleteActions\(streamedReply\)/);
  assert.match(run, /sendActions\(actions, 'final'\)/);
  assert.doesNotMatch(run, /send\('actions:new', \{\s*actions: parseActions/);
});

test('capture lifecycle resets state and archives the requested session shape', () => {
  assert.match(mainSource, /function startSession\(\)[\s\S]*transcript\.splice\(0, transcript\.length\)[\s\S]*transcriptSeq = 0[\s\S]*resetInsights\(\)[\s\S]*resetActions\(\)[\s\S]*autoScreenText = null/);
  assert.match(mainSource, /function archiveSession\(\)[\s\S]*\{ startedAt: sessionStartedAt \|\| endedAt, endedAt, transcript, insightsShown \}/);
  assert.match(mainSource, /fs\.promises\.mkdir[\s\S]*fs\.promises\.writeFile/);
});
