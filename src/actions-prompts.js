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
  return 'Return 1-3 useful live-meeting chips, or nothing. "Them" is others; "You" is the user. ' + emphasis + '\n'
    + 'Only output: ACTION: <answer|define|challenge|screen|say|recap> | <label of <=6 words> | <payload>\n'
    + 'Payloads must be exact contiguous transcript quotes: never invent, paraphrase, combine, or shorten. '
    + 'answer and challenge quote only "Them:"; define quotes a term; screen is visible material; say is a speaking moment; recap only follows a long conversation.';
}

function buildActionsTurn(transcript) {
  return 'Recent conversation:\n' + (formatTranscript(transcript, 8) || '(nothing yet)')
    + '\n\nWhat actions, if any, are worth surfacing?';
}

function parseActions(text) {
  const actions = [];
  for (const rawLine of String(text || '').split('\n')) {
    const match = rawLine.trim().match(/^ACTION:\s*(answer|define|challenge|screen|say|recap)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/i);
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

function parseCompleteActions(text) {
  const source = String(text || '');
  const lastNewline = source.lastIndexOf('\n');
  return lastNewline < 0 ? [] : parseActions(source.slice(0, lastNewline + 1));
}

function isQuestionTurn(text) {
  const turn = String(text || '').trim();
  return /\?$/.test(turn) || /^(what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|will)\b/i.test(turn);
}

module.exports = { buildActionsSystem, buildActionsTurn, parseActions, parseCompleteActions, isQuestionTurn, PERSONA_EMPHASIS };
