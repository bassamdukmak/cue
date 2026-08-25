const assert = require('node:assert/strict');
const test = require('node:test');
const { LocalWhisperTranscriber } = require('../src/local-whisper-transcriber');

test('runs each channel through its own persistent session', async () => {
  let activeInferences = 0;
  let maximumConcurrency = 0;
  const transcribedChannels = [];
  const transcripts = [];
  const sessions = [];

  const transcriber = new LocalWhisperTranscriber({
    sessionOptions: {},
    sessionFactory: () => {
      const session = {
        startCalls: 0,
        stopCalls: 0,
        async start() { this.startCalls += 1; },
        async transcribe(pcm) {
          activeInferences += 1;
          maximumConcurrency = Math.max(maximumConcurrency, activeInferences);
          await new Promise((resolve) => setImmediate(resolve));
          activeInferences -= 1;
          return pcm.toString();
        },
        abortInferences() {},
        async stop() { this.stopCalls += 1; }
      };
      sessions.push(session);
      return session;
    },
    segmenterFactory: (options) => ({
      push(pcm) {
        transcribedChannels.push(options.channel);
        options.onUtterance(options.channel, Buffer.from(pcm));
      },
      stop() {}
    }),
    onTranscript: (channel, text) => transcripts.push({ channel, text })
  });

  await transcriber.start();
  transcriber.push('you', Buffer.from('first'));
  transcriber.push('them', Buffer.from('second'));
  await transcriber._drainQueue();
  await transcriber.stop();

  assert.equal(sessions.length, 2);
  assert.ok(sessions.every((session) => session.startCalls === 1));
  assert.ok(sessions.every((session) => session.stopCalls === 1));
  assert.equal(maximumConcurrency, 2);
  assert.deepEqual(transcribedChannels, ['you', 'them']);
  assert.deepEqual(transcripts, [
    { channel: 'you', text: 'first' },
    { channel: 'them', text: 'second' }
  ]);
});

test('bounds shutdown drain time before aborting an in-flight inference', async () => {
  let rejectInference;
  const stopOptions = [];
  const reportedErrors = [];
  let abortCalls = 0;
  let transcribeCalls = 0;
  const fakeSession = {
    async start() {},
    async transcribe() {
      transcribeCalls += 1;
      return new Promise((_resolve, reject) => { rejectInference = reject; });
    },
    abortInferences() {
      abortCalls += 1;
      rejectInference(new Error('inference aborted'));
    },
    async stop(options) { stopOptions.push(options); }
  };
  const transcriber = new LocalWhisperTranscriber({
    sessionOptions: {},
    sessionFactory: () => fakeSession,
    segmenterFactory: (options) => ({
      push(pcm) { options.onUtterance(options.channel, Buffer.from(pcm)); },
      stop() {}
    }),
    drainTimeoutMs: 0,
    onError: (error) => reportedErrors.push(error)
  });

  await transcriber.start();
  transcriber.push('you', Buffer.from('pending'));
  transcriber.push('them', Buffer.from('discard me'));
  await transcriber.stop();
  await transcriber._drainQueue();

  assert.equal(abortCalls, 2);
  assert.equal(transcribeCalls, 2);
  assert.deepEqual(reportedErrors, []);
  assert.deepEqual(stopOptions, [{ force: true }, { force: true }]);
});
