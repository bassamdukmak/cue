const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildActionsSystem, buildActionsTurn, parseActions } = require('../src/actions-prompts');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('parseActions accepts valid action lines and caps the result', () => {
  assert.deepEqual(parseActions([
    'ACTION: answer | Answer this | What is the timeline?',
    'ACTION: define | Define term | CAC payback',
    'ACTION: challenge | Check claim | We doubled revenue.',
    'ACTION: say | Speak now | They asked for your view.',
  ].join('\n')), [
    { kind: 'answer', label: 'Answer this', payload: 'What is the timeline?' },
    { kind: 'define', label: 'Define term', payload: 'CAC payback' },
    { kind: 'challenge', label: 'Check claim', payload: 'We doubled revenue.' },
  ]);
});

test('parseActions drops malformed lines and accepts an empty reply', () => {
  assert.deepEqual(parseActions('ACTION: answer | seven label words are too many here | What now?\nACTION: nope | Bad | payload\nhello'), []);
  assert.deepEqual(parseActions(''), []);
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
  assert.match(mainSource, /send\('actions:new', \{\s*actions: parseActions/);
  assert.match(mainSource, /ipcMain\.on\('action:invoke'/);
  assert.match(mainSource, /answer: \['answerThis', payload\]/);
  assert.match(mainSource, /define: \['answerThis', 'Define: ' \+ payload\]/);
  assert.match(mainSource, /challenge: \['answerThis', payload\]/);
  assert.match(mainSource, /say: \['say', ''\]/);
  assert.match(mainSource, /recap: \['recap', ''\]/);
});

test('capture lifecycle resets state and archives the requested session shape', () => {
  assert.match(mainSource, /function startSession\(\)[\s\S]*transcript\.splice\(0, transcript\.length\)[\s\S]*transcriptSeq = 0[\s\S]*resetInsights\(\)[\s\S]*resetActions\(\)[\s\S]*autoScreenText = null/);
  assert.match(mainSource, /function archiveSession\(\)[\s\S]*\{ startedAt: sessionStartedAt \|\| endedAt, endedAt, transcript, insightsShown \}/);
  assert.match(mainSource, /fs\.promises\.mkdir[\s\S]*fs\.promises\.writeFile/);
});
