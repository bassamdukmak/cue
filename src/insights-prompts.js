// insights-prompts.js — The continuously-updating side panel.
//
// Different job from the mode buttons. Those answer a question the user asked;
// this one runs on its own and quietly accumulates what has been established so
// far, so the user can glance left and see the meeting rather than re-read a
// transcript.
//
// Two kinds of line, because they are read differently: INSIGHT is something
// now known, ACTION is something to do about it. The panel groups them.

const { formatTranscript } = require('./prompts');

// What each persona is watching for. Everything else about the panel is shared —
// only the lens changes, so a mode switch does not need a whole second prompt.
const PERSONA_FOCUS = {
  interview:
    'what the interviewer has revealed about the role, the team and what they are '
    + 'looking for, plus anything the user should be ready to answer next.',
  attack:
    'claims that have been made and how well supported each one is. Mark a claim '
    + 'SHAKY when it is unsupported, imprecise or overstated. Actions are the '
    + 'questions worth asking about them.',
  negotiation:
    'every number named and who named it first, what each side has conceded, and '
    + 'what they have revealed about their priorities and constraints.',
  decode:
    'terms, acronyms and shorthand that have been used, with short plain-language '
    + 'meanings. Mark anything that looks company-specific as INTERNAL rather than '
    + 'guessing what it means.',
  standup:
    'what each person has committed to and by when, quoting the words used. '
    + 'Actions are what the user still needs to clarify or push back on.',
};

const BASE_RULES =
  'You have no internet access. Never add a fact, figure, date or name that was not '
  + 'actually said in the transcript — this panel is a record of the meeting, not '
  + 'commentary on the topic.\n'
  + '- Each line must stand alone and be under 14 words. The user reads these out of '
  + 'the corner of their eye.\n'
  + '- No preamble, no headings, no numbering. Only the prefixed lines.\n'
  + '- Report only what is genuinely established. An empty response is correct when '
  + 'nothing new has been said.';

function buildInsightsSystem(persona) {
  const focus = PERSONA_FOCUS[persona] || PERSONA_FOCUS.interview;
  return 'You maintain a live side panel during a meeting. "Them" is everyone else; '
    + '"You" is the user.\n\n'
    + 'Track ' + focus + '\n\n'
    + BASE_RULES + '\n\n'
    + 'Output only lines with these exact prefixes:\n'
    + 'INSIGHT: <something now established>\n'
    + 'ACTION: <something the user should ask or do>\n\n'
    + 'Return ONLY genuinely new lines. Anything already listed below has been shown '
    + 'to the user — repeating it wastes the panel. If nothing new has been said since, '
    + 'return nothing at all.';
}

function buildInsightsTurn(transcript, existing) {
  const known = existing.length
    ? 'Already on the panel — do not repeat these:\n' + existing.map((line) => '- ' + line).join('\n')
    : 'The panel is empty so far.';
  return 'Conversation:\n' + (formatTranscript(transcript, 24) || '(nothing yet)')
    + '\n\n' + known
    + '\n\nWhat is new?';
}

// The model returns prefixed lines; anything else it emits is dropped rather than
// shown, so a stray sentence of preamble cannot pollute the panel.
function parseInsights(text) {
  const insights = [];
  const actions = [];
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    const insight = line.match(/^INSIGHT:\s*(.+)$/i);
    if (insight) { insights.push(insight[1].trim()); continue; }
    const action = line.match(/^ACTION:\s*(.+)$/i);
    if (action) actions.push(action[1].trim());
  }
  return { insights, actions };
}

module.exports = { buildInsightsSystem, buildInsightsTurn, parseInsights, PERSONA_FOCUS };
