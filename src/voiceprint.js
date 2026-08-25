const fs = require('fs');

const SAMPLE_RATE = 16000;
const MIN_MODEL_BYTES = 39.5 * 1024 * 1024;
// Sherpa examples use 0.6 for a normal match. Requiring <0.45 to relabel leaves
// a wide uncertain band labelled "you", which is safer for this product.
const VOICEPRINT_RELABEL_THRESHOLD = 0.45;

function normalize(vector) {
  const magnitude = Math.hypot(...vector);
  if (!magnitude) throw new Error('Voiceprint embedding was empty. Please record again.');
  return Float32Array.from(vector, (value) => value / magnitude);
}

function averageEmbeddings(embeddings) {
  if (!embeddings.length) throw new Error('Record three voice samples before enrolling.');
  const dimension = embeddings[0].length;
  if (!dimension || embeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error('Voice samples did not produce compatible embeddings. Please record again.');
  }
  const sum = new Float32Array(dimension);
  for (const embedding of embeddings) {
    for (let index = 0; index < dimension; index += 1) sum[index] += embedding[index];
  }
  return normalize(sum);
}

function cosineSimilarity(left, right) {
  if (left.length !== right.length) throw new Error('Voiceprint dimensions do not match.');
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

function pcm16ToFloat32(pcm) {
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readInt16LE(index * 2) / 32768;
  return samples;
}

function shouldRelabelMicTurn(verification) {
  return verification.enrolled && verification.similarity < VOICEPRINT_RELABEL_THRESHOLD;
}

function createVoiceprintService({ store, modelPath, createExtractor, isModelReady } = {}) {
  if (!store || !modelPath) throw new Error('Voiceprint service needs the settings store and model path.');
  let extractor = null;

  function modelReady() {
    if (isModelReady) return isModelReady(modelPath);
    try {
      return fs.statSync(modelPath).size >= MIN_MODEL_BYTES;
    } catch (_) {
      return false;
    }
  }

  function getExtractor() {
    if (extractor) return extractor;
    if (!modelReady()) throw new Error('The speaker model is still downloading. Try again when it finishes.');
    extractor = createExtractor();
    return extractor;
  }

  function embed(pcm) {
    if (!Buffer.isBuffer(pcm) || pcm.length < SAMPLE_RATE) throw new Error('Voice sample is too short. Please record again.');
    const speakerExtractor = getExtractor();
    const stream = speakerExtractor.createStream();
    stream.acceptWaveform({ samples: pcm16ToFloat32(pcm), sampleRate: SAMPLE_RATE });
    stream.inputFinished();
    if (!speakerExtractor.isReady(stream)) throw new Error('Voice sample was not ready for embedding. Please record again.');
    return speakerExtractor.compute(stream);
  }

  function enrolledVector() {
    const vector = store.getSettings().voiceprint?.vector;
    return Array.isArray(vector) && vector.length ? Float32Array.from(vector) : null;
  }

  return {
    status() {
      return { enrolled: !!enrolledVector(), modelReady: modelReady() };
    },
    enroll(samples) {
      if (!Array.isArray(samples) || samples.length !== 3) throw new Error('Record all three five-second voice samples.');
      const vector = averageEmbeddings(samples.map(embed));
      store.setSettings({ voiceprint: { vector: Array.from(vector) } });
      return this.status();
    },
    verify(pcm) {
      const vector = enrolledVector();
      if (!vector) return { enrolled: false, similarity: null };
      return { enrolled: true, similarity: cosineSimilarity(embed(pcm), vector) };
    },
    delete() {
      store.setSettings({ voiceprint: null });
      return this.status();
    }
  };
}

module.exports = {
  MIN_MODEL_BYTES,
  SAMPLE_RATE,
  VOICEPRINT_RELABEL_THRESHOLD,
  averageEmbeddings,
  cosineSimilarity,
  createVoiceprintService,
  shouldRelabelMicTurn,
};
