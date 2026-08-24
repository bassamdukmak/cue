const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { OPTIONAL_API_KEY_PLACEHOLDER } = require('../src/openai-compatible');
const { PERSONAS } = require('../src/personas');

let capturedClientOptions = null;
let capturedCompletionRequest = null;
let capturedCompletionRequests = [];
let mockStreamParts = [{ choices: [{ delta: { content: 'ok' } }] }];
let mockStreams = null;
let mockSpawn = null;
const originalModuleLoad = Module._load;

Module._load = function loadWithOpenAIStub(request, parent, isMain) {
  if (request === 'openai') {
    return class FakeOpenAI {
      constructor(clientOptions) {
        capturedClientOptions = clientOptions;
        this.chat = {
          completions: {
            create: async (completionRequest) => {
              capturedCompletionRequest = completionRequest;
              capturedCompletionRequests.push(completionRequest);
              return mockStreams ? mockStreams.shift() : mockStreamParts;
            }
          }
        };
      }
    };
  }
  if (request === 'child_process' && mockSpawn) return { spawn: mockSpawn };
  return originalModuleLoad.call(this, request, parent, isMain);
};

const { createLLM, formatProviderErrorMessage, isQuotaError, CURRENT_GEMINI_DEFAULT, CURRENT_DEEPSEEK_DEFAULT, buildReadScreenTool, stripDeepSeekToolMarkup, createToolMarkupSanitizer, parseDeepSeekToolCalls } = require('../src/llm');

test.after(() => {
  Module._load = originalModuleLoad;
});

function createCustomSettings(overrides = {}) {
  return {
    provider: 'custom',
    smart: false,
    baseUrl: 'http://127.0.0.1:18789/v1',
    apiKeys: { custom: 'gateway-token' },
    models: { custom: { fast: 'openclaw/default', smart: 'openclaw/default' } },
    ...overrides
  };
}

test.beforeEach(() => {
  capturedClientOptions = null;
  capturedCompletionRequest = null;
  capturedCompletionRequests = [];
  mockStreamParts = [{ choices: [{ delta: { content: 'ok' } }] }];
  mockStreams = null;
  mockSpawn = null;
});

test('routes the Custom provider through the configured OpenAI-compatible endpoint', async () => {
  const receivedTokens = [];
  const llm = createLLM(createCustomSettings());

  assert.equal(llm.ready, true);
  assert.equal(llm.model, 'openclaw/default');

  const response = await llm.stream({
    system: 'Be concise.',
    turns: [{ role: 'user', text: 'Hello' }],
    onToken: (token) => receivedTokens.push(token)
  });

  assert.deepEqual(capturedClientOptions, {
    apiKey: 'gateway-token',
    baseURL: 'http://127.0.0.1:18789/v1'
  });
  assert.equal(capturedCompletionRequest.model, 'openclaw/default');
  assert.equal(response, 'ok');
  assert.deepEqual(receivedTokens, ['ok']);
});

test('allows an unauthenticated local Custom endpoint', async () => {
  const llm = createLLM(createCustomSettings({ apiKeys: { custom: '' } }));
  await llm.stream({ system: '', turns: [], onToken: () => {} });

  assert.equal(capturedClientOptions.apiKey, OPTIONAL_API_KEY_PLACEHOLDER);
});

test('does not apply the Custom Base URL to official OpenAI requests', async () => {
  const llm = createLLM({
    provider: 'openai',
    smart: false,
    baseUrl: 'http://127.0.0.1:18789/v1',
    apiKeys: { openai: 'official-openai-key' },
    models: { openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' } }
  });

  await llm.stream({ system: '', turns: [], onToken: () => {} });

  assert.deepEqual(capturedClientOptions, { apiKey: 'official-openai-key' });
});

test('reports incomplete Custom endpoint settings without making a request', () => {
  const llm = createLLM(createCustomSettings({ baseUrl: '' }));

  assert.equal(llm.ready, false);
  assert.match(llm.configurationError, /Set a Base URL/);
  assert.equal(capturedClientOptions, null);
});

test('requires a model for the Custom provider', () => {
  const llm = createLLM(createCustomSettings({
    models: { custom: { fast: '', smart: '' } }
  }));

  assert.equal(llm.ready, false);
  assert.match(llm.configurationError, /Set a Fast or Smart model/);
});

function deepseekSettings(overrides = {}) {
  return createCustomSettings({
    baseUrl: 'https://api.deepseek.com/v1',
    models: { custom: { fast: CURRENT_DEEPSEEK_DEFAULT, smart: CURRENT_DEEPSEEK_DEFAULT } },
    ...overrides
  });
}

test('DeepSeek fast streams visible content, activity-only reasoning, and disabled thinking', async () => {
  mockStreamParts = [
    { choices: [{ delta: { reasoning_content: 'private reasoning' } }] },
    { choices: [{ delta: { content: 'visible answer' } }] },
  ];
  const tokens = [];
  let activities = 0;
  const llm = createLLM(deepseekSettings());
  const reply = await llm.stream({
    system: 's', turns: [{ role: 'user', text: 'hi' }], mode: 'ask',
    onToken: (token) => tokens.push(token), onActivity: () => { activities += 1; }
  });

  assert.deepEqual(capturedCompletionRequest.thinking, { type: 'disabled' });
  assert.equal(capturedCompletionRequest.temperature, 1);
  assert.equal(reply, 'visible answer');
  assert.deepEqual(tokens, ['visible answer']);
  assert.equal(activities, 1);
});

test('DeepSeek smart enables thinking without sending temperature', async () => {
  const llm = createLLM(deepseekSettings({ smart: true }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], onToken: () => {} });

  assert.deepEqual(capturedCompletionRequest.thinking, { type: 'enabled' });
  assert.equal(Object.hasOwn(capturedCompletionRequest, 'temperature'), false);
});

test('DeepSeek Vision Exp sends the original image as an OpenAI image_url part', async () => {
  const llm = createLLM(deepseekSettings());
  await llm.stream({
    system: 's',
    turns: [{ role: 'user', text: 'Read this screen.' }],
    imageDataUrl: 'data:image/jpeg;base64,c2NyZWVu',
    onToken: () => {}
  });

  assert.deepEqual(capturedCompletionRequest.messages.at(-1), {
    role: 'user',
    content: [
      { type: 'text', text: 'Read this screen.' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,c2NyZWVu' } }
    ]
  });
});

test('DeepSeek LeetCode fast calls use temperature zero', async () => {
  const llm = createLLM(deepseekSettings());
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], mode: 'leetcode', onToken: () => {} });

  assert.equal(capturedCompletionRequest.temperature, 0);
});

test('DeepSeek Vision Exp does not receive unsupported tools', async () => {
  const llm = createLLM(deepseekSettings());
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'search Syria news' }], onToken: () => {}, onToolCall: async () => null });

  assert.equal(llm.supportsTools, false);
  assert.equal(capturedCompletionRequest.tools, undefined);
});

test('DeepSeek tool continuations preserve reasoning content', async () => {
  mockStreams = [
    [
      { choices: [{ delta: { reasoning_content: 'I need a source.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'search_facts', arguments: '{"query":"Syria"}' } }] } }] },
    ],
    [{ choices: [{ delta: { content: 'Sourced Syria update.' } }] }],
  ];
  const llm = createLLM(deepseekSettings({ models: { custom: { fast: 'deepseek-v4-flash', smart: 'deepseek-v4-flash' } } }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'search Syria news' }], onToken: () => {}, onToolCall: async () => ({ summary: 'result' }) });

  assert.equal(capturedCompletionRequests[1].messages.at(-2).reasoning_content, 'I need a source.');
});

test('accumulates split search_facts tool calls and streams the continued answer', async () => {
  mockStreams = [
    [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'search_', arguments: '{"query":"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'facts', arguments: 'moon landing"}' } }] } }] },
    ],
    [{ choices: [{ delta: { content: 'SAY: sourced answer\nconf: sourced' } }] }],
  ];
  const queries = [];
  const tokens = [];
  const llm = createLLM(createCustomSettings());
  const reply = await llm.stream({
    system: 's', turns: [{ role: 'user', text: 'verify it' }], onToken: (token) => tokens.push(token),
    onToolCall: async (query) => { queries.push(query); return { summary: 'Apollo 11 landed in 1969.', source: 'Wikipedia', url: 'https://example.test' }; }
  });

  assert.deepEqual(queries, ['moon landing']);
  assert.equal(capturedCompletionRequests.length, 2);
  assert.deepEqual(capturedCompletionRequests[0].tools[0].function.name, 'search_facts');
  assert.match(capturedCompletionRequests[0].tools[0].function.description, /GitHub, npm, PyPI, endoflife\.date, OSV\.dev, Stack Exchange, AWS Pricing, IETF Datatracker, RFC Editor, US Bureau of Labor Statistics, Our World in Data/);
  assert.equal(capturedCompletionRequests[1].tools, undefined);
  assert.equal(capturedCompletionRequests[1].messages.at(-2).role, 'assistant');
  assert.equal(capturedCompletionRequests[1].messages.at(-1).role, 'tool');
  assert.match(capturedCompletionRequests[1].messages.at(-1).content, /Apollo 11/);
  assert.equal(reply, 'SAY: sourced answer\nconf: sourced');
  assert.deepEqual(tokens, ['SAY: sourced answer\nconf: sourced']);
});

test('falls back to DSML content tool calls without rendering the markup', async () => {
  const dsml = 'I\'ll search for recent news about Syria.<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="search_facts"> <｜｜DSML｜｜parameter name="query" string="true">Syria news this week</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>';
  mockStreams = [[{ choices: [{ delta: { content: dsml } }] }], [{ choices: [{ delta: { content: 'Sourced Syria update.' } }] }]];
  const queries = [];
  const tokens = [];
  const reply = await createLLM(createCustomSettings()).stream({
    system: 's', turns: [{ role: 'user', text: 'search Syria news' }], onToken: token => tokens.push(token),
    onToolCall: async query => { queries.push(query); return { summary: 'result' }; }
  });

  assert.deepEqual(queries, ['Syria news this week']);
  assert.equal(capturedCompletionRequests.length, 2);
  assert.doesNotMatch(tokens.join(''), /DSML|tool_calls/);
  assert.doesNotMatch(reply, /DSML|tool_calls/);
});

test('sanitises complete and partial DeepSeek tool markup before streaming it', () => {
  assert.equal(stripDeepSeekToolMarkup('safe <|tool▁calls|><|tool▁call▁begin|>search_facts {"query":"Syria"}'), 'safe ');
  const sanitizer = createToolMarkupSanitizer();
  assert.equal(sanitizer.push('safe <｜｜D'), 'safe ');
  assert.equal(sanitizer.push('SML｜｜tool_calls>hidden'), '');
  assert.equal(sanitizer.finish(), '');
});

test('parses only offered DSML and BPE fallback tools', () => {
  const dsml = '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="search_facts"><｜｜DSML｜｜parameter name="query" string="true">Syria news</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>';
  const bpe = '<|tool▁calls|><|tool▁call▁begin|>search_facts<|tool▁call▁argument▁begin|>{"query":"Syria news"}<|tool▁call▁argument▁end|><|tool▁call▁end|><|tool▁calls▁end|>';
  assert.deepEqual(parseDeepSeekToolCalls(dsml, ['search_facts'])[0].function, { name: 'search_facts', arguments: '{"query":"Syria news"}' });
  assert.deepEqual(parseDeepSeekToolCalls(bpe, ['search_facts'])[0].function, { name: 'search_facts', arguments: '{"query":"Syria news"}' });
  assert.deepEqual(parseDeepSeekToolCalls(dsml.replace('search_facts', 'erase_everything'), ['search_facts']), []);
});

test('search tool description advertises configured optional sources', async () => {
  const llm = createLLM(createCustomSettings({ apiKeys: { custom: 'gateway-token', fmp: 'fmp-key', finnhub: 'finnhub-key' } }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'verify it' }], onToken: () => {}, onToolCall: async () => null });
  assert.match(capturedCompletionRequest.tools[0].function.description, /FMP, Finnhub/);
});

test('read_screen is offered whenever a persona supplies the screen callback', async () => {
  const tool = buildReadScreenTool();
  assert.equal(tool.function.name, 'read_screen');
  assert.match(tool.function.description, /slide, diagram, dashboard, spreadsheet, code/i);
  assert.match(tool.function.description, /conversation already answers/i);

  for (const persona of Object.keys(PERSONAS)) {
    const llm = createLLM(createCustomSettings());
    await llm.stream({
      system: `s:${persona}`, turns: [{ role: 'user', text: 'help' }], onToken: () => {},
      onScreenRequest: async () => ({ text: 'unused' })
    });
    assert.deepEqual(capturedCompletionRequest.tools.map((entry) => entry.function.name), ['read_screen'], persona);
  }
});

test('accumulates split read_screen calls and gives its error result to the model', async () => {
  mockStreams = [
    [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'screen-1', type: 'function', function: { name: 'read_', arguments: '{"reason":"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'screen', arguments: 'read the slide"}' } }] } }] },
    ],
    [{ choices: [{ delta: { content: 'I cannot read it.' } }] }],
  ];
  const reasons = [];
  const llm = createLLM(createCustomSettings());
  const reply = await llm.stream({
    system: 's', turns: [{ role: 'user', text: 'what does this slide say?' }], onToken: () => {},
    onScreenRequest: async (reason) => {
      reasons.push(reason);
      return { error: 'screen recording permission not granted' };
    }
  });

  assert.deepEqual(reasons, ['read the slide']);
  assert.deepEqual(capturedCompletionRequests[0].tools.map((entry) => entry.function.name), ['read_screen']);
  assert.match(capturedCompletionRequests[1].messages.at(-1).content, /screen recording permission not granted/);
  assert.equal(reply, 'I cannot read it.');
});

test('caps screen reads at one while allowing one search in the same request', async () => {
  mockStreams = [
    [{ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'search-1', type: 'function', function: { name: 'search_facts', arguments: '{"query":"moon"}' } },
      { index: 1, id: 'screen-1', type: 'function', function: { name: 'read_screen', arguments: '{}' } },
      { index: 2, id: 'screen-2', type: 'function', function: { name: 'read_screen', arguments: '{}' } },
    ] } }] }],
    [{ choices: [{ delta: { content: 'combined answer' } }] }],
  ];
  let searches = 0;
  let screenReads = 0;
  const llm = createLLM(createCustomSettings());
  await llm.stream({
    system: 's', turns: [{ role: 'user', text: 'check it' }], onToken: () => {},
    onToolCall: async () => { searches += 1; return { summary: 'search result' }; },
    onScreenRequest: async () => { screenReads += 1; return { text: 'screen result' }; }
  });

  assert.equal(searches, 1);
  assert.equal(screenReads, 1);
  assert.deepEqual(capturedCompletionRequests[0].tools.map((entry) => entry.function.name), ['search_facts', 'read_screen']);
  const toolMessages = capturedCompletionRequests[1].messages.filter((message) => message.role === 'tool');
  assert.equal(toolMessages.length, 3);
  assert.match(toolMessages[2].content, /Only one screen read is allowed/);
});

test('Claude CLI remains ready without a key and reports a clear missing-binary error', async () => {
  mockSpawn = () => {
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      const error = new Error('spawn claude ENOENT');
      error.code = 'ENOENT';
      child.emit('error', error);
    });
    return child;
  };
  const llm = createLLM({ provider: 'claudecli', smart: false, apiKeys: {}, models: { claudecli: { fast: 'haiku', smart: 'sonnet' } } });
  assert.equal(llm.ready, true);
  await assert.rejects(
    llm.stream({ system: 's', turns: [{ role: 'user', text: 'hello' }], onToken: () => {} }),
    /Claude CLI is not installed or is not on PATH/
  );
});

// ---- MiniMax (PR #22) -----------------------------------------------------
// MiniMax is OpenAI-compatible and region-split, so these assert the regional
// gateway selection rather than any new transport.

function minimaxSettings(overrides) {
  return Object.assign({
    provider: 'minimax',
    smart: true,
    apiKeys: { minimax: 'test-key' },
    models: { minimax: { fast: 'MiniMax-M2.7', smart: 'MiniMax-M3' } }
  }, overrides || {});
}

test('selects the MiniMax model for the active tier and reports readiness', () => {
  const smart = createLLM(minimaxSettings({ smart: true }));
  assert.equal(smart.provider, 'minimax');
  assert.equal(smart.model, 'MiniMax-M3');
  assert.equal(smart.ready, true);

  const fast = createLLM(minimaxSettings({ smart: false }));
  assert.equal(fast.model, 'MiniMax-M2.7');
});

test('routes MiniMax to the global OpenAI-compatible endpoint by default', async () => {
  capturedClientOptions = null;
  const llm = createLLM(minimaxSettings({ minimaxRegion: 'global_en' }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], onToken: () => {} });
  assert.equal(capturedClientOptions.baseURL, 'https://api.minimax.io/v1');
  assert.equal(capturedClientOptions.apiKey, 'test-key');
});

test('routes MiniMax to the China endpoint when that region is selected', async () => {
  capturedClientOptions = null;
  const llm = createLLM(minimaxSettings({ minimaxRegion: 'cn_zh' }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], onToken: () => {} });
  assert.equal(capturedClientOptions.baseURL, 'https://api.minimaxi.com/v1');
});

test('falls back to the global endpoint for an unknown region', async () => {
  capturedClientOptions = null;
  const llm = createLLM(minimaxSettings({ minimaxRegion: 'unknown' }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], onToken: () => {} });
  assert.equal(capturedClientOptions.baseURL, 'https://api.minimax.io/v1');
});

// ---- Gemini 404/429 error mapping ------------------------------------------
// Reproduces the exact bug-report clusters: "Error: got status: 404 Not Found.
// {"error":{"message":"exception parsing response","code":404,"status":"Not
// Found"}}" (dead/misspelled model) and 429 quota exhaustion, and asserts they
// come out as actionable in-app messages instead of the raw provider JSON.

function geminiApiError({ status, body }) {
  const err = new Error(`got status: ${status}. ${JSON.stringify(body)}`);
  err.name = 'ApiError';
  err.status = status; // matches @google/genai's ApiError shape
  return err;
}

test('formatProviderErrorMessage: maps a Gemini 404 to an actionable "model unavailable" message', () => {
  const error = geminiApiError({
    status: 404,
    body: { error: { message: 'exception parsing response', code: 404, status: 'Not Found' } }
  });
  const message = formatProviderErrorMessage(error, 'gemini', 'gemini-2.0-flash');
  assert.match(message, /Gemini/);
  assert.match(message, /model "gemini-2\.0-flash"/);
  assert.match(message, /unavailable \(404\)/);
  assert.match(message, /Settings/);
  assert.doesNotMatch(message, /exception parsing response/);
});

test('formatProviderErrorMessage: 404 message still works without a model id', () => {
  const error = geminiApiError({ status: 404, body: { error: { message: 'not found', code: 404 } } });
  const message = formatProviderErrorMessage(error, 'openai');
  assert.match(message, /OpenAI model is unavailable \(404\)/);
});

test('formatProviderErrorMessage: maps a Gemini 429 to a free-tier quota message', () => {
  const error = geminiApiError({
    status: 429,
    body: { error: { message: 'You exceeded your current quota', code: 429, status: 'RESOURCE_EXHAUSTED' } }
  });
  const message = formatProviderErrorMessage(error, 'gemini', 'gemini-2.5-flash');
  assert.match(message, /Gemini free-tier quota exhausted \(429/);
  assert.match(message, /billing/);
  assert.doesNotMatch(message, /RESOURCE_EXHAUSTED/);
});

test('formatProviderErrorMessage: surfaces retry-after when the 429 body carries a RetryInfo delay', () => {
  const error = geminiApiError({
    status: 429,
    body: {
      error: {
        message: 'Resource exhausted',
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '38s' }]
      }
    }
  });
  const message = formatProviderErrorMessage(error, 'gemini');
  assert.match(message, /Wait about 38s/);
});

test('formatProviderErrorMessage: 429 without a retry delay falls back to a generic wait hint', () => {
  const error = new Error('429 Too Many Requests');
  error.status = 429;
  const message = formatProviderErrorMessage(error, 'openai');
  assert.match(message, /Wait a moment/);
});

test('formatProviderErrorMessage: an OpenAI-style quota 429 (no numeric status) is still recognized', () => {
  // Matches the literal text one of the bug reports pasted in.
  const error = new Error('429 You exceeded your current quota, please check your plan and billing details.');
  const message = formatProviderErrorMessage(error, 'openai');
  assert.match(message, /OpenAI free-tier quota exhausted/);
});

test('formatProviderErrorMessage: an unrecognized error passes its raw message through unchanged', () => {
  const error = new Error('socket hang up');
  assert.equal(formatProviderErrorMessage(error, 'anthropic'), 'socket hang up');
});

test('isQuotaError: agrees with formatProviderErrorMessage on what counts as quota', () => {
  assert.equal(isQuotaError(geminiApiError({ status: 429, body: {} })), true);
  assert.equal(isQuotaError(geminiApiError({ status: 404, body: {} })), false);
  assert.equal(isQuotaError(new Error('insufficient_quota')), true);
});

// ---- Gemini model selection / self-healing migration -----------------------

function geminiSettings(overrides) {
  return Object.assign({
    provider: 'gemini',
    smart: false,
    apiKeys: { gemini: 'test-key' }
  }, overrides || {});
}

test('createLLM: falls back to CURRENT_GEMINI_DEFAULT when no model is configured', () => {
  const llm = createLLM(geminiSettings({ models: {} }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
  assert.equal(llm.ready, true);
});

test('createLLM: a fresh install (store.js DEFAULTS shape) resolves to the current default', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-2.5-flash', smart: 'gemini-2.5-flash' } }
  }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
});

test('createLLM: self-heals a settings file saved with the retired gemini-2.0-flash default', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-2.0-flash', smart: 'gemini-2.0-flash' } }
  }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
});

test('createLLM: self-heals a legacy gemini-1.5-* model saved before the 2.0-flash migration existed', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-1.5-flash', smart: 'gemini-1.5-pro' } },
    smart: true
  }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
});

test('createLLM: leaves a user-chosen current Gemini model alone', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-3.5-flash', smart: 'gemini-3.5-flash' } }
  }));
  assert.equal(llm.model, 'gemini-3.5-flash');
});

test('createLLM: self-heals retired DeepSeek aliases when reading saved models', () => {
  const llm = createLLM(deepseekSettings({
    smart: true,
    models: { custom: { fast: 'deepseek-chat', smart: 'deepseek-reasoner' } }
  }));

  assert.equal(llm.model, CURRENT_DEEPSEEK_DEFAULT);
});
