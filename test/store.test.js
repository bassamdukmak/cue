const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const test = require('node:test');

const storePath = require.resolve('../src/store');

function loadStore(directory) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => directory } };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[storePath];
  try {
    return require('../src/store');
  } finally {
    Module._load = originalLoad;
  }
}

test('corrupt settings are preserved and reported', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  const file = path.join(directory, 'cue-data.json');
  fs.writeFileSync(file, '{not json');
  try {
    const store = loadStore(directory);
    assert.throws(() => store.getSettings(), /Settings are corrupt/);
    const preserved = fs.readdirSync(directory).find((name) => name.startsWith('cue-data.json.corrupt-'));
    assert.ok(preserved);
    assert.equal(fs.readFileSync(path.join(directory, preserved), 'utf8'), '{not json');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('settings write failures leave the previous in-memory settings intact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  const originalWriteFileSync = fs.writeFileSync;
  try {
    const store = loadStore(directory);
    fs.writeFileSync = () => { throw new Error('disk full'); };
    assert.throws(() => store.setSettings({ provider: 'anthropic' }), /disk full/);
    assert.equal(store.getSettings().provider, 'openai');
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
