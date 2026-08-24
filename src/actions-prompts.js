// actions-prompts.js — Small, clickable next steps for automatic mode.

const { formatTranscript } = require('./prompts');

const PERSONA_EMPHASIS = {
  normal: 'favour the clearest next question or speaking moment.',
  interview: 'favour questions the other person just asked and moments to answer.',
  attack: 'favour checkable claims that deserve a challenge.',
  negotiation: 'favour claims, numbers, and moments where the user should respond.',
  decode: 'favour terms, acronyms, and jargon worth defining.',
  standup: 'favour commitments, blockers, and moments where the user should speak.',
};

function buildActionsSystem(persona) {
  const emphasis = PERSONA_EMPHASIS[persona] || PERSONA_EMPHASIS.interview;
  return 'You propose 1-3 compact clickable actions from a live meeting transcript. "Them" is everyone else; "You" is the user. '
    + emphasis + '\n\n'
    + 'Only propose something genuinely actionable. Return nothing when there is none. '
    + 'Every payload must be copied verbatim from the transcript: never invent, paraphrase, combine, or shorten it. '
    + 'A payload is an exact contiguous quote from the transcript. Labels may summarize but must be six words or fewer. '
    + 'Use recap only after a long stretch of conversation.\n\n'
    + 'Output one line per action, with no preamble or numbering:\n'
    + 'ACTION: <kind> | <label> | <payload>\n\n'
    + 'Kinds:\n'
    + 'answer — a question someone just asked; payload is that question verbatim.\n'
    + 'define — a term worth explaining; payload is that term verbatim.\n'
    + 'challenge — a checkable claim; payload is that claim verbatim.\n'
    + 'say — a moment where the user should speak; payload is one-line context verbatim.\n'
    + 'recap — only after a long stretch; payload is one-line context verbatim.';
}

function buildActionsTurn(transcript) {
  return 'Recent conversation:\n' + (formatTranscript(transcript, 8) || '(nothing yet)')
    + '\n\nWhat actions, if any, are worth surfacing?';
}

function parseActions(text) {
  const actions = [];
  for (const rawLine of String(text || '').split('\n')) {
    const match = rawLine.trim().match(/^ACTION:\s*(answer|define|challenge|say|recap)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/i);
    if (!match) continue;
    const [, kind, rawLabel, rawPayload] = match;
    const label = rawLabel.trim();
    const payload = rawPayload.trim();
    if (!label || !payload || label.split(/\s+/).length > 6) continue;
    actions.push({ kind: kind.toLowerCase(), label, payload });
    if (actions.length === 3) break;
  }
  return actions;
}

module.exports = { buildActionsSystem, buildActionsTurn, parseActions, PERSONA_EMPHASIS };
