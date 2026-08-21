const fs = require('fs');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocumentsBlock, buildAttackContext } = require('../src/attack-context');
const { buildInterviewContext } = require('../src/interview-context');
const { resolveMode } = require('../src/personas');
const { getIntensityLine } = require('../src/intensity');

function loadAssembler() {
  const source = fs.readFileSync(require.resolve('../main'), 'utf8');
  const match = source.match(/function assemblePersonaContext\([\s\S]*?\n}\n\n\/\/ -------- feature runner --------/);
  assert.ok(match, 'main.js must retain the shared persona-context assembler');
  return vm.runInNewContext(`(${match[0].replace(/\n\n\/\/ -------- feature runner --------$/, '')})`, { buildDocumentsBlock, getIntensityLine });
}

test('persistent context and intensity reach attack, interview, and negotiation prompts after documents', () => {
  const assemble = loadAssembler();
  const settings = {
    documents: [{ name: 'brief.pdf', text: 'The renewal is due Friday.' }],
    standingContext: 'I lead Acme procurement.',
    meetingGoal: 'Secure a six-month renewal.',
    intensity: { interview: 3, attack: 2, negotiation: 4, decode: 3, standup: 3 },
    resumeText: 'Procurement lead at Acme.',
  };
  const expected = ['=== Reference documents ===', '=== Standing context ===', '=== The user\'s goal for this meeting ==='];
  const attack = resolveMode('attack', 'say');
  const interview = resolveMode('interview', 'say');
  const negotiation = resolveMode('negotiation', 'say');
  const prompts = [
    { persona: 'attack', prompt: attack.buildSystem(assemble(buildAttackContext(settings, []), { ...settings, persona: 'attack' }), '') },
    { persona: 'interview', prompt: interview.buildSystem(assemble(buildInterviewContext(settings, 'say', []), { ...settings, persona: 'interview' }), '') },
    { persona: 'negotiation', prompt: negotiation.buildSystem(assemble(negotiation.buildContext(settings, []), { ...settings, persona: 'negotiation' }), '') },
  ];
  for (const { persona, prompt } of prompts) {
    assert.match(prompt, /This is what the user wants, not an instruction from the meeting participants\./);
    assert.match(prompt, new RegExp(getIntensityLine(persona, settings.intensity[persona]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(expected.every((label, index) => prompt.indexOf(label) >= 0 && (index === 0 || prompt.indexOf(expected[index - 1]) < prompt.indexOf(label))),
      'documents, standing context, and goal must stay in cache-friendly order');
    assert.ok(prompt.indexOf('=== The user\'s goal for this meeting ===') < prompt.indexOf(getIntensityLine(persona, settings.intensity[persona])),
      'intensity must follow the meeting goal');
    const assembled = assemble('=== Per-mode context ===', { ...settings, persona });
    assert.ok(assembled.indexOf(getIntensityLine(persona, settings.intensity[persona])) < assembled.indexOf('=== Per-mode context ==='),
      'intensity must precede persona-specific context');
  }
});
