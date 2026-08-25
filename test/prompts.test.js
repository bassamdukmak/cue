const test = require('node:test');
const assert = require('node:assert/strict');
const { MODES, TRANSCRIPT_SPEAKER_HEADER } = require('../src/prompts');
const { ATTACK_MODES } = require('../src/attack-prompts');
const { NEGOTIATION_MODES } = require('../src/negotiation-prompts');
const { DECODE_MODES } = require('../src/decode-prompts');
const { STANDUP_MODES } = require('../src/standup-prompts');
const { NORMAL_MODES } = require('../src/normal-prompts');
const fs = require('node:fs');
const path = require('node:path');

test('assist mode gives a direct answer in first person', () => {
  const system = MODES.assist.buildSystem(null);
  const text = system + '\n' + MODES.assist.build({ transcript: [], userText: '' });
  // System prompt must instruct to answer in first person with no preamble
  assert.match(text, /first person/i);
  assert.match(text, /no preamble|preamble/i);
});

test('say mode produces a spoken answer not a question', () => {
  const system = MODES.say.buildSystem(null);
  const text = system + '\n' + MODES.say.build({ transcript: [], userText: '' });
  assert.match(text, /say out loud|in first person/i);
  // Must instruct a terse spoken line, not meta-instructions.
  assert.match(text, /SAY: <=20 words|speakable words only/i);
});

test('assembled transcript prompts include the shared speaker-label header', () => {
  const prompt = MODES.say.build({ transcript: [{ channel: 'them', text: 'Can you ship it?' }], userText: '' });
  assert.match(prompt, new RegExp(TRANSCRIPT_SPEAKER_HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /Them: Can you ship it\?/);
});

test('leetcode mode ignores context block and returns coding prompt', () => {
  const system = MODES.leetcode.buildSystem('IGNORED_CONTEXT');
  assert.match(system, /competitive programmer|coding problem/i);
  assert.ok(!system.includes('IGNORED_CONTEXT'), 'leetcode should not include context block');
});

test('followup mode returns terse spoken lines', () => {
  const system = MODES.followup.buildSystem(null);
  assert.match(system, /SAY: line|SAY: <=20 words/i);
});

test('all modes have a build function', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    assert.equal(typeof mode.build, 'function', `${name}.build must be a function`);
    assert.equal(typeof mode.buildSystem, 'function', `${name}.buildSystem must be a function`);
  }
});

test('every mode declares its own SAY-line contract without multi-line contradictions', () => {
  const tables = [MODES, ATTACK_MODES, NEGOTIATION_MODES, DECODE_MODES, STANDUP_MODES, NORMAL_MODES];
  for (const table of tables) {
    for (const [name, mode] of Object.entries(table)) {
      assert.match(mode.buildSystem(null), /SAY-line contract:/, `${name} must declare its SAY-line count`);
    }
  }

  const multiple = [
    [MODES.followup, '2–4'], [ATTACK_MODES.probe, '0–3'], [NEGOTIATION_MODES.press, 'exactly 3'],
    [DECODE_MODES.askSmart, 'exactly 2'], [STANDUP_MODES.clarify, '1–3'], [NORMAL_MODES.questions, '1–3'],
  ];
  for (const [mode, contract] of multiple) {
    const prompt = mode.buildSystem(null);
    assert.match(prompt, new RegExp(`SAY-line contract: ${contract}`));
    assert.doesNotMatch(prompt, /exactly one SAY/i);
  }
});

// ── AI rules ────────────────────────────────────────────────────────────────
const RULES = 'Never use em-dashes.\nReply in 2-3 short bullet points.\nUse a casual tone.';

test('every non-leetcode mode injects AI rules into its system prompt', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    if (name === 'leetcode') continue;
    const withRules = mode.buildSystem(null, RULES);
    assert.match(withRules, /--- USER RULES ---/, `${name}.buildSystem should append USER RULES block`);
    assert.ok(withRules.includes(RULES), `${name}.buildSystem should include the user's rules verbatim`);
  }
});

test('every non-leetcode mode returns the base prompt unchanged when no rules are set', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    if (name === 'leetcode') continue;
    const without = mode.buildSystem(null, '');
    const blank = mode.buildSystem(null, null);
    assert.ok(!without.includes('USER RULES'), `${name} should not include USER RULES when aiRules is empty`);
    assert.ok(!blank.includes('USER RULES'), `${name} should not include USER RULES when aiRules is null`);
  }
});

test('leetcode mode never applies AI rules (coding answers stay strict)', () => {
  const withRules = MODES.leetcode.buildSystem(null, RULES);
  assert.ok(!withRules.includes('USER RULES'), 'leetcode must not include USER RULES');
  assert.ok(!withRules.includes(RULES), 'leetcode must not leak user rules into the prompt');
  assert.match(withRules, /competitive programmer/);
});

test('screen-unavailable fallback stays silent and every persona can request a screen read', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /Never mention or imply missing screenshots/);
  assert.match(main, /Never apologize, explain, or ask or offer the user to describe, paste, or provide screen content/);
  assert.match(main, /output only: NOTE: Visual context is required/);

  const screenModes = [
    MODES.assist, MODES.ask, MODES.leetcode, ATTACK_MODES.factcheck,
    DECODE_MODES.decodeScreen, STANDUP_MODES.blockers, NEGOTIATION_MODES.position,
    NORMAL_MODES.helpScreen,
  ];
  for (const mode of screenModes) {
    const prompt = mode.buildSystem(null);
    assert.match(prompt, /read_screen/i);
    assert.match(prompt, /conversation alone is insufficient/i);
  }

  for (const table of [MODES, ATTACK_MODES, NEGOTIATION_MODES, DECODE_MODES, STANDUP_MODES, NORMAL_MODES]) {
    for (const mode of Object.values(table)) assert.match(mode.buildSystem(null), /read_screen/i);
  }
});
