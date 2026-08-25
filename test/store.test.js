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

test('search is off, auto-listen is on by default, and Claude CLI models are present', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  try {
    const store = loadStore(directory);
    const settings = store.getSettings();
    // Off by default: an ask-gated search holds the busy lock behind a click.
    assert.equal(settings.searchMode, 'off');
    assert.equal(settings.chipQuestions, true);
    assert.equal(settings.autoListen, true);
    assert.equal(settings.apiKeys.github, '');
    assert.deepEqual(settings.models.claudecli, { fast: 'haiku', smart: 'sonnet' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the former Vision Exp default pair migrates back to text-only Flash without replacing explicit choices', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  const file = path.join(directory, 'cue-data.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ models: { custom: { fast: 'deepseek-v4-flash-vision-exp', smart: 'deepseek-v4-flash-vision-exp' } } }));
    assert.deepEqual(loadStore(directory).getSettings().models.custom, {
      fast: 'deepseek-v4-flash', smart: 'deepseek-v4-flash'
    });

    fs.writeFileSync(file, JSON.stringify({ models: { custom: { fast: 'deepseek-v4-flash-vision-exp', smart: 'other-model' } } }));
    assert.deepEqual(loadStore(directory).getSettings().models.custom, {
      fast: 'deepseek-v4-flash-vision-exp', smart: 'other-model'
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('lifetime usage is saved with its complete persistent shape', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-'));
  try {
    const store = loadStore(directory);
    const usageLifetime = {
      promptTokens: 1200, cachedTokens: 300, completionTokens: 90, calls: 2, costUsd: 0.0042,
      byModel: { 'gpt-4o-mini': { promptTokens: 1200, cachedTokens: 300, completionTokens: 90, calls: 2 } },
      since: '2026-08-22T10:00:00.000Z'
    };
    store.setSettings({ usageLifetime });
    assert.deepEqual(loadStore(directory).getSettings().usageLifetime, usageLifetime);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
