const test = require('node:test');
const assert = require('node:assert/strict');

const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');

function functionBody(name) {
  const start = source.indexOf('function ' + name);
  assert.notEqual(start, -1, name + ' is missing');
  const body = source.slice(start);
  return body.slice(0, body.indexOf('\n  }\n'));
}

test('persona UI changes only after persistence and restores on rejection', () => {
  const body = functionBody('setPersona');
  assert.ok(body.indexOf('await cue.settingsSet(patch)') < body.indexOf('syncPersonaUI()'));
  assert.match(body, /catch \(error\)[\s\S]*settings\.persona = previousPersona[\s\S]*syncPersonaUI\(\)/);
});

test('settings only close after a successful awaited save', () => {
  const body = functionBody('closeSettings');
  assert.match(body, /if \(await saveSettings\(\)\) scrim\.classList\.add\('hidden'\)/);
  assert.equal((source.match(/function openSettings\(/g) || []).length, 1);
  assert.equal((source.match(/function closeSettings\(/g) || []).length, 1);
});

test('local-model status clears after local start and provider change', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /await startLocalWhisper\(settings\);\n\s*send\('status', \{ message: '', persistent: true, key: 'local-model' \}\)/);
  assert.match(main, /saved\.sttProvider !== previousSttProvider[\s\S]*key: 'local-model'/);
});
