const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  VOICEPRINT_RELABEL_THRESHOLD,
  averageEmbeddings,
  cosineSimilarity,
  createVoiceprintService,
  shouldRelabelMicTurn,
} = require('../src/voiceprint');

function pcm(seconds = 5) {
  return Buffer.alloc(16000 * 2 * seconds, 12);
}

function service(settings = { voiceprint: null }) {
  const store = {
    getSettings: () => settings,
    setSettings: (patch) => { settings.voiceprint = patch.voiceprint; },
  };
  const extractor = {
    createStream: () => ({ acceptWaveform() {}, inputFinished() {} }),
    isReady: () => true,
    compute: () => new Float32Array([1, 0]),
  };
  return { settings, service: createVoiceprintService({ store, modelPath: __filename, createExtractor: () => extractor, isModelReady: () => true }) };
}

test('enrolment averages three samples and persists one normalized centroid', () => {
  const centroid = averageEmbeddings([new Float32Array([1, 0]), new Float32Array([1, 0])]);
  assert.deepEqual(Array.from(centroid), [1, 0]);

  const { settings, service: voiceprint } = service();
  voiceprint.enroll([pcm(), pcm(), pcm()]);
  assert.deepEqual(settings.voiceprint.vector, [1, 0]);
  assert.equal(voiceprint.status().enrolled, true);
});

test('verification compares an embedding to the stored centroid', () => {
  const { service: voiceprint } = service({ voiceprint: { vector: [1, 0] } });
  assert.equal(voiceprint.verify(pcm()).similarity, 1);
  assert.equal(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1])), 0);
});

test('deleting a voiceprint erases its vector from settings', () => {
  const { settings, service: voiceprint } = service({ voiceprint: { vector: [1, 0] } });
  voiceprint.delete();
  assert.equal(settings.voiceprint, null);
  assert.equal(voiceprint.status().enrolled, false);
});

test('only a clearly low microphone similarity is relabelled', () => {
  assert.equal(shouldRelabelMicTurn({ enrolled: true, similarity: VOICEPRINT_RELABEL_THRESHOLD - 0.01 }), true);
  assert.equal(shouldRelabelMicTurn({ enrolled: true, similarity: VOICEPRINT_RELABEL_THRESHOLD }), false);
  assert.equal(shouldRelabelMicTurn({ enrolled: false, similarity: 0 }), false);
});

test('main applies voiceprint relabelling only to microphone turns', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const publish = source.slice(source.indexOf('async function publishTranscript'), source.indexOf('\n}\n\nasync function reportMissingLocalModel'));
  assert.match(publish, /if \(channel === 'you' && voiceprintMicBuffer\.read\(\)\.length\)/);
  assert.doesNotMatch(publish, /channel === 'them'.*voiceprint\.verify/s);
});
