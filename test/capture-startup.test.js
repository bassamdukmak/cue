const test = require('node:test');
const assert = require('node:assert/strict');
const mainSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');

test('auto-listen uses the shared capture toggle after the window loads', () => {
  assert.match(mainSource, /function toggleCapture\(\)/);
  assert.match(mainSource, /ipcMain\.handle\('capture:toggle', toggleCapture\)/);
  assert.match(mainSource, /setTimeout\(\(\) => \{\s*if \(store\.getSettings\(\)\.autoListen && !desiredCaptureState\) toggleCapture\(\);\s*\}, 2000\)/);
});

test('every published off capture state carries the persistent not-listening status', () => {
  assert.match(mainSource, /function publishCaptureState\(active, streaming = false, mode = 'off'\)[\s\S]*?message: active \? '' : NOT_LISTENING_MESSAGE, persistent: true, key: 'not-listening'/);
  assert.match(mainSource, /const NOT_LISTENING_MESSAGE = 'Not listening — press ▶ to start'/);
});
