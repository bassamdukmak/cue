// personas.js — Chooses which prompt table backs the UI buttons.
//
// The renderer, the composer and the global shortcuts all keep passing plain
// mode strings ("say", "assist", …). Only this lookup knows a persona exists,
// which is why none of those call sites needed to change.
//
// Lives in its own module rather than in prompts.js so that the persona prompt
// tables can reuse prompts.js helpers without a circular require.

const { MODES } = require('./prompts');
const { ATTACK_MODES } = require('./attack-prompts');
const { NEGOTIATION_MODES } = require('./negotiation-prompts');
const { DECODE_MODES } = require('./decode-prompts');
const { STANDUP_MODES } = require('./standup-prompts');

// Each persona remaps the six conversational modes and falls through for
// anything it does not override, so leetcode keeps its strict interview prompt
// everywhere.
const PERSONAS = {
  interview: {
    label: 'Interview',
    hint: 'Help me answer well',
    modes: null,            // null = the original table, untouched
  },
  attack: {
    label: 'Fact-check',
    hint: 'Challenge what they claim',
    usesAggression: true,
    modes: {
      say: ATTACK_MODES.challenge,
      assist: ATTACK_MODES.factcheck,
      followup: ATTACK_MODES.probe,
      recap: ATTACK_MODES.patterns,
      ask: ATTACK_MODES.selfcheck,
      answerThis: ATTACK_MODES.verdict,
    },
  },
  negotiation: {
    label: 'Negotiation',
    hint: 'Salary, vendors, contracts',
    modes: {
      say: NEGOTIATION_MODES.respond,
      assist: NEGOTIATION_MODES.position,
      followup: NEGOTIATION_MODES.press,
      recap: NEGOTIATION_MODES.ledger,
      ask: NEGOTIATION_MODES.rehearse,
      answerThis: NEGOTIATION_MODES.decode,
    },
  },
  decode: {
    label: 'Decode',
    hint: 'Explain what they just said',
    modes: {
      say: DECODE_MODES.define,
      assist: DECODE_MODES.decodeScreen,
      followup: DECODE_MODES.askSmart,
      recap: DECODE_MODES.glossary,
      ask: DECODE_MODES.explain,
      answerThis: DECODE_MODES.defineThis,
    },
  },
  standup: {
    label: 'Standup',
    hint: 'Track what I commit to',
    modes: {
      say: STANDUP_MODES.update,
      assist: STANDUP_MODES.blockers,
      followup: STANDUP_MODES.clarify,
      recap: STANDUP_MODES.commitments,
      ask: STANDUP_MODES.checkCommit,
      answerThis: STANDUP_MODES.parseAsk,
    },
  },
};

function resolveMode(persona, mode) {
  const table = PERSONAS[persona] && PERSONAS[persona].modes;
  if (table && table[mode]) return table[mode];
  return MODES[mode];
}

module.exports = { resolveMode, PERSONAS };
