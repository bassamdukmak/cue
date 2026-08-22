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

test('failed atomic settings writes leave the prior valid file and memory intact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  const file = path.join(directory, 'cue-data.json');
  const originalWriteFileSync = fs.writeFileSync;
  try {
    const store = loadStore(directory);
    store.setSettings({ provider: 'gemini' });
    fs.writeFileSync = (target, ...args) => {
      if (target === `${file}.tmp`) throw new Error('disk full');
      return originalWriteFileSync(target, ...args);
    };
    assert.throws(() => store.setSettings({ provider: 'anthropic' }), /disk full/);
    assert.equal(store.getSettings().provider, 'gemini');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).provider, 'gemini');
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy aggression migrates into attack intensity without retaining the old key', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  const file = path.join(directory, 'cue-data.json');
  fs.writeFileSync(file, JSON.stringify({ aggression: 5, intensity: { negotiation: 4 } }));
  try {
    const store = loadStore(directory);
    const settings = store.getSettings();
    assert.equal(settings.intensity.attack, 5);
    assert.equal(settings.intensity.negotiation, 4);
    assert.equal(Object.hasOwn(settings, 'aggression'), false);
    store.setSettings({ persona: 'attack' });
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')), 'aggression'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('new settings default to Ask first search and include Claude CLI models', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  try {
    const store = loadStore(directory);
    const settings = store.getSettings();
    assert.equal(settings.searchMode, 'ask');
    assert.deepEqual(settings.models.claudecli, { fast: 'haiku', smart: 'sonnet' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
