// Simple JSON-file settings store (avoids native modules so `npm install` stays clean).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeBaseUrl } = require('./openai-compatible');

const FILE = path.join(app.getPath('userData'), 'cue-data.json');

// Cap on the user's custom response rules. Generous but bounded: anything longer
// should live in a real prompt file, not in a settings field.
const MAX_AI_RULES_CHARS = 2000;

const DEFAULTS = {
  provider: 'openai',
  sttProvider: 'auto',
  localWhisper: {
    modelId: 'base.en',
    language: 'auto',
    threads: 0
  },
  smart: false,
  baseUrl: '',
  minimaxRegion: 'global_en',
  apiKeys: { openai: '', anthropic: '', gemini: '', deepgram: '', custom: '', ollama: '', groq: '', minimax: '' , azure: '' },
  azureEndpoint: '',
  // Tab 2: Profile
  resumeText: '',
  jobDescription: '',
  // Tab 3: Interview Prep
  starStories: '',       // 3-5 behavioral STAR stories in plain English
  whyCompany: '',        // Why do you want to work here?
  whyLeaving: '',        // Why are you leaving your current job?
  workStyle: '',         // How you work, decision-making style, values
  // Tab 4: Q&A
  salaryTarget: '',      // e.g. "$150k-$180k base + equity"
  questionsToAsk: '',    // Questions to ask the interviewer
  // Tab 5: Style — custom response rules
  // The user writes how the AI should write: e.g. "no em-dashes", "use bullet
  // points", "casual tone". Applied to every LLM mode EXCEPT LeetCode (kept
  // strict for coding problems).
  aiRules: '',
  // Tab 6: Meeting — the attack persona (live fact-checking)
  // 'interview' keeps every original prompt; 'attack' swaps the six
  // conversational modes for claim-challenging ones.
  autoSuggest: false,    // suggest automatically when the other side stops talking
  persona: 'interview',
  intensity: { interview: 3, attack: 2, negotiation: 3, decode: 3, standup: 3 },
  roster: '',            // one per line: "Name | ally|neutral|target | notes"
  documents: [],         // [{ name, text, chars }] reference files for fact-checking
  meetingGoal: '',       // short-lived outcome for the current meeting
  standingContext: '',   // durable user/company/project context for every persona
  negotiationFloor: '',  // walk-away point — never revealed, never conceded past
  negotiationNotes: '',  // other priorities: start date, equity, scope, timeline

  // Window position
  windowX: null,
  windowY: null,
  models: {
    openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' },
    anthropic: { fast: 'claude-3-5-haiku-latest', smart: 'claude-3-5-sonnet-latest' },
    // Kept in sync with CURRENT_GEMINI_DEFAULT in src/llm.js — gemini-2.0-flash
    // (the previous default here) was retired by Google on 2026-03-03 and 404s
    // on every request. gemini-2.5-flash is current and free-tier available.
    gemini: { fast: 'gemini-2.5-flash', smart: 'gemini-2.5-flash' },
    custom: { fast: '', smart: '' },
    ollama: { fast: 'llama3.2', smart: 'llama3.3' },
    groq: { fast: 'llama-3.1-8b-instant', smart: 'llama-3.3-70b-versatile' },
    minimax: { fast: 'MiniMax-M2.7', smart: 'MiniMax-M3' },
    azure: { fast: 'gpt-4o-mini', smart: 'gpt-4o' }
  }
};

let data = null;

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      if (k === 'aiRules' && typeof over[k] === 'string') {
        out[k] = over[k].slice(0, MAX_AI_RULES_CHARS);
      } else {
        out[k] = over[k];
      }
    }
  }
  return out;
}

function migrateSettings(stored) {
  if (!stored || typeof stored !== 'object' || !Object.hasOwn(stored, 'aggression')) return stored;
  const { aggression, intensity, ...withoutAggression } = stored;
  return {
    ...withoutAggression,
    intensity: {
      ...(intensity && typeof intensity === 'object' && !Array.isArray(intensity) ? intensity : {}),
      attack: aggression,
    },
  };
}

function load() {
  if (data) return data;
  try {
    data = deepMerge(DEFAULTS, migrateSettings(JSON.parse(fs.readFileSync(FILE, 'utf8'))));
  } catch (error) {
    if (error.code === 'ENOENT') {
      data = deepMerge(DEFAULTS, {});
      return data;
    }
    if (error instanceof SyntaxError) {
      const preserved = `${FILE}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(FILE, preserved);
      } catch (renameError) {
        throw new Error(`Settings are corrupt and could not be preserved: ${renameError.message}`);
      }
      throw new Error(`Settings are corrupt. The original file was preserved as ${path.basename(preserved)}.`);
    }
    throw new Error(`Settings could not be read: ${error.message}`);
  }
  return data;
}
function save(nextSettings) {
  const tempFile = `${FILE}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(nextSettings, null, 2));
    const fd = fs.openSync(tempFile, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempFile, FILE);
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch (_) {}
    throw error;
  }
  data = nextSettings;
}

module.exports = {
  MAX_AI_RULES_CHARS,
  getSettings() { return load(); },
  setSettings(patch) {
    load();
    const nextSettings = deepMerge(data, patch || {});
    nextSettings.baseUrl = normalizeBaseUrl(nextSettings.baseUrl);
    save(nextSettings);
    return data;
  }
};
