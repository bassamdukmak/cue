const { AGGRESSION } = require('./attack-context');

const INTENSITIES = {
  interview: {
    title: 'Presence',
    levels: [
      ['Reserved', 'Let the evidence speak; do not sell too hard.', 'Presence: reserved. Be measured and let the user’s evidence speak without overselling.'],
      ['Measured', 'Calmly connect relevant experience to the question.', 'Presence: measured. Connect relevant experience to the question calmly, without exaggeration.'],
      ['Confident', 'State strengths clearly and back them with proof.', 'Presence: confident. State the user’s strengths clearly and support them with specific evidence.'],
      ['Persuasive', 'Make a direct case for the user’s fit.', 'Presence: persuasive. Make a direct, credible case for why the user is a strong fit.'],
      ['Bold', 'Lead with the strongest credible case for the user.', 'Presence: bold. Lead with the user’s strongest credible case and do not undersell it.'],
    ],
  },
  attack: {
    title: 'Aggression',
    levels: [
      ['Gentle', 'Frame doubt as your own uncertainty.', AGGRESSION[1]],
      ['Curious', 'Ask for the source without passing judgment.', AGGRESSION[2]],
      ['Direct', 'State the disagreement plainly.', AGGRESSION[3]],
      ['Pointed', 'Name the gap in the reasoning.', AGGRESSION[4]],
      ['Blunt', 'Correct the claim without softeners.', AGGRESSION[5]],
    ],
  },
  negotiation: {
    title: 'Firmness',
    levels: [
      ['Accommodating', 'Prioritize rapport and workable options.', 'Firmness: accommodating. Prioritize rapport and workable options while protecting the user’s interests.'],
      ['Cooperative', 'Look for mutual gains and clear trade-offs.', 'Firmness: cooperative. Look for mutual gains and make trade-offs clear without giving away the user’s position.'],
      ['Balanced', 'Hold the position while staying flexible on the path.', 'Firmness: balanced. Hold the user’s position while staying flexible about how to reach an agreement.'],
      ['Firm', 'Make boundaries and asks explicit.', 'Firmness: firm. Make the user’s boundaries and asks explicit; stay respectful and solution-oriented.'],
      ['Hardline', 'Protect the position without becoming personal or rude.', 'Firmness: hardline. Protect the user’s position decisively; be firm on the issue and soft on people, never rude.'],
    ],
  },
  decode: {
    title: 'Depth',
    levels: [
      ['Quick gloss', 'Give the shortest useful meaning.', 'Depth: quick gloss. Give the shortest useful explanation and skip detail unless it is essential.'],
      ['Clear', 'Explain the main point in plain language.', 'Depth: clear. Explain the main point in plain language with only the context needed to understand it.'],
      ['Guided', 'Include the key reasoning and one useful example.', 'Depth: guided. Explain the key reasoning and include one useful example when it clarifies the point.'],
      ['Detailed', 'Cover important terms, logic, and implications.', 'Depth: detailed. Cover the important terms, logic, and practical implications without unnecessary detours.'],
      ['Thorough', 'Fully unpack the meaning, reasoning, and caveats.', 'Depth: thorough. Fully unpack the meaning, reasoning, assumptions, and caveats so the user can act on it.'],
    ],
  },
  standup: {
    title: 'Stance',
    levels: [
      ['Modest', 'State progress without overselling or pushing back.', 'Stance: modest. State progress plainly and keep pushback light unless it is necessary.'],
      ['Grounded', 'Explain scope and blockers with concrete facts.', 'Stance: grounded. Explain scope, progress, and blockers with concrete facts and calm accountability.'],
      ['Clear', 'Make commitments, limits, and needs unambiguous.', 'Stance: clear. Make commitments, scope limits, and needed decisions unambiguous.'],
      ['Firm', 'Defend the agreed scope and push back when needed.', 'Stance: firm. Defend the agreed scope and push back on unreasonable changes with specific reasons.'],
      ['Assertive', 'Strongly defend scope and request a clear decision.', 'Stance: assertive. Strongly defend the user’s scope and ask for a clear decision when pressure would create an unsound commitment.'],
    ],
  },
};

const DEFAULT_LEVELS = { interview: 3, attack: 2, negotiation: 3, decode: 3, standup: 3 };

function getIntensityMeta(persona) {
  const intensity = INTENSITIES[persona] || INTENSITIES.interview;
  return {
    title: intensity.title,
    levels: intensity.levels.map(([name, desc]) => ({ name, desc })),
  };
}

function getIntensityLine(persona, level) {
  const key = INTENSITIES[persona] ? persona : 'interview';
  const index = Number(level) - 1;
  const fallback = DEFAULT_LEVELS[key] - 1;
  return (INTENSITIES[key].levels[index] || INTENSITIES[key].levels[fallback])[2];
}

module.exports = { getIntensityLine, getIntensityMeta };
