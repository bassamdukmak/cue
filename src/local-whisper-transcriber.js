const { UtteranceSegmenter } = require('./utterance-segmenter');
const { WhisperServerSession } = require('./whisper-server-session');

const CHANNELS = Object.freeze(['you', 'them']);
const DEFAULT_DRAIN_TIMEOUT_MS = 15000;

class LocalWhisperTranscriber {
  /** Keep one persistent model session per channel so simultaneous speakers do not block each other. */
  constructor({
    sessionOptions,
    sessionFactory = (options) => new WhisperServerSession(options),
    segmenterFactory = (options) => new UtteranceSegmenter(options),
    drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
    onTranscript = () => {},
    onSpeechState = () => {},
    onStatus = () => {},
    onError = () => {}
  }) {
    this.sessionOptions = sessionOptions;
    this.sessionFactory = sessionFactory;
    this.segmenterFactory = segmenterFactory;
    this.drainTimeoutMs = drainTimeoutMs;
    this.onTranscript = onTranscript;
    this.onSpeechState = onSpeechState;
    this.onStatus = onStatus;
    this.onError = onError;
    this.segmenters = new Map();
    this.sessions = new Map();
    this.queueTails = new Map();
    this.speechEndedAt = new Map();
    this.pendingJobs = 0;
    this.acceptingAudio = false;
    this.discardPendingJobs = false;
  }

  async start() {
    this.discardPendingJobs = false;
    for (const channel of CHANNELS) {
      this.sessions.set(channel, this.sessionFactory({
        ...this.sessionOptions,
        onState: (status) => this.onStatus({ ...status, channel })
      }));
      this.queueTails.set(channel, Promise.resolve());
    }
    await Promise.all([...this.sessions.values()].map((session) => session.start()));
    for (const channel of CHANNELS) {
      const isRemoteAudio = channel === 'them';
      this.segmenters.set(channel, this.segmenterFactory({
        channel,
        vadOptions: {
          onsetThreshold: isRemoteAudio ? 200 : 220,
          offsetThreshold: isRemoteAudio ? 120 : 130,
          silenceFrames: isRemoteAudio ? 20 : 18
        },
        onSpeechState: (speechChannel, speaking, durationMs) => {
          if (!speaking) this.speechEndedAt.set(speechChannel, Date.now());
          this.onSpeechState(speechChannel, speaking, durationMs);
        },
        onUtterance: (utteranceChannel, pcm) => this._enqueue(utteranceChannel, pcm)
      }));
    }
    this.acceptingAudio = true;
  }

  push(channel, pcm) {
    if (!this.acceptingAudio) return;
    const segmenter = this.segmenters.get(channel);
    if (!segmenter) throw new Error(`Unknown local Whisper channel: ${channel}`);
    segmenter.push(pcm);
  }

  async stop() {
    this.acceptingAudio = false;
    for (const segmenter of this.segmenters.values()) segmenter.stop();

    const drained = await this._drainQueue();
    if (!drained) {
      this.discardPendingJobs = true;
      for (const session of this.sessions.values()) session.abortInferences();
    }
    await Promise.all([...this.sessions.values()].map((session) => session.stop({ force: !drained })));
    this.sessions.clear();
    this.queueTails.clear();
    this.segmenters.clear();
    this.onStatus({ status: 'off', message: 'Local Whisper stopped.' });
  }

  forceStop() {
    this.acceptingAudio = false;
    this.discardPendingJobs = true;
    for (const session of this.sessions.values()) session.abortInferences();
    return Promise.all([...this.sessions.values()].map((session) => session.stop({ force: true }))).then(() => {
      this.sessions.clear();
      this.queueTails.clear();
    });
  }

  _enqueue(channel, pcm) {
    const session = this.sessions.get(channel);
    if (!session) return;
    this.pendingJobs += 1;
    this.onStatus({ status: 'transcribing', channel, pending: this.pendingJobs });
    const timing = {
      speechEndedAt: this.speechEndedAt.get(channel) || null,
      audioFlushAt: Date.now()
    };

    const job = (this.queueTails.get(channel) || Promise.resolve()).then(async () => {
      if (this.discardPendingJobs) return;
      timing.whisperStartedAt = Date.now();
      const text = await session.transcribe(pcm);
      timing.transcriptionCompletedAt = Date.now();
      if (text) this.onTranscript(channel, text, timing);
    });

    this.queueTails.set(channel, job
      .catch((error) => {
        if (!this.discardPendingJobs) this.onError(error);
      })
      .finally(() => {
        this.pendingJobs -= 1;
        if (this.acceptingAudio && this.pendingJobs === 0) {
          this.onStatus({ status: 'ready', message: 'Local Whisper is ready.' });
        }
      }));
    return job;
  }

  async _drainQueue() {
    let timeout = null;
    try {
      return await Promise.race([
        Promise.all([...this.queueTails.values()]).then(() => true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(false), this.drainTimeoutMs);
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

module.exports = { LocalWhisperTranscriber, CHANNELS, DEFAULT_DRAIN_TIMEOUT_MS };
