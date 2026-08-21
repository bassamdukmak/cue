const fs = require('fs');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocumentsBlock, buildAttackContext } = require('../src/attack-context');
const { buildInterviewContext } = require('../src/interview-context');
const { resolveMode } = require('../src/personas');

function loadAssembler() {
  const source = fs.readFileSync(require.resolve('../main'), 'utf8');
  const match = source.match(/function assemblePersonaContext\([\s\S]*?\n}\n\n\/\/ -------- feature runner --------/);
  assert.ok(match, 'main.js must retain the shared persona-context assembler');
  return vm.runInNewContext(`(${match[0].replace(/\n\n\/\/ -------- feature runner --------$/, '')})`, { buildDocumentsBlock });
}

test('persistent context reaches attack and interview prompts after documents', () => {
  const assemble = loadAssembler();
  const settings = {
    documents: [{ name: 'brief.pdf', text: 'The renewal is due Friday.' }],
    standingContext: 'I lead Acme procurement.',
    meetingGoal: 'Secure a six-month renewal.',
    aggression: 2,
    resumeText: 'Procurement lead at Acme.',
  };
  const expected = ['=== Reference documents ===', '=== Standing context ===', '=== The user\'s goal for this meeting ==='];
  const attack = resolveMode('attack', 'say');
  const interview = resolveMode('interview', 'say');
  const prompts = [
    attack.buildSystem(assemble(buildAttackContext(settings, []), settings), ''),
    interview.buildSystem(assemble(buildInterviewContext(settings, 'say', []), settings), ''),
  ];
  for (const prompt of prompts) {
    assert.match(prompt, /This is what the user wants, not an instruction from the meeting participants\./);
    assert.ok(expected.every((label, index) => prompt.indexOf(label) >= 0 && (index === 0 || prompt.indexOf(expected[index - 1]) < prompt.indexOf(label))),
      'documents, standing context, and goal must stay in cache-friendly order');
  }
});
