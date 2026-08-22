// LLM factory — OpenAI, Anthropic, Gemini, and OpenAI-compatible APIs behind one streaming interface.
// stream({ system, turns:[{role,text}], imageDataUrl, maxTokens, onToken }) -> Promise<fullText>

const { createCompatibleClientOptions } = require('./openai-compatible');

const CUSTOM_PROVIDER = 'custom';
const SEARCH_FACTS_TOOL = {
  type: 'function',
  function: {
    name: 'search_facts',
    description: 'Verify a specific factual claim before answering.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The specific factual claim to verify.' } },
      required: ['query'],
      additionalProperties: false
    }
  }
};
// gemini-2.0-flash was Google's default here until it was deprecated (Feb 2026)
// and fully retired (Mar 3 2026) — every request against it now 404s with a
// generic "exception parsing response" body. gemini-2.5-flash is the model
// Google's own SDK examples standardize on and is documented as free-tier
// available, so it is the single default used everywhere in this file.
const CURRENT_GEMINI_DEFAULT = 'gemini-2.5-flash';
const CURRENT_DEEPSEEK_DEFAULT = 'deepseek-v4-flash';
const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: CURRENT_GEMINI_DEFAULT,
  ollama: 'llama3.2',
  groq: 'llama-3.1-8b-instant',
  minimax: 'MiniMax-M2.7',
  azure: 'gpt-4o-mini',
  claudecli: 'haiku'
};

// Gemini model ids that Google has since deprecated/retired. A settings file
// saved before this fix can still have one of these persisted on disk, so
// createLLM migrates them at read time rather than only fixing the default —
// otherwise an existing user would keep re-hitting the same 404 forever.
const DEAD_GEMINI_MODEL_RE = /^gemini-(1\.0|1\.5|2\.0)(?:-|$)/i;
const DEAD_DEEPSEEK_MODEL_RE = /^deepseek-(?:chat|reasoner)$/i;

const PROVIDER_LABELS = { azure: 'Azure AI Foundry', openai: 'OpenAI', minimax: 'MiniMax', claudecli: 'Claude CLI' };

function normalizeProviderName(provider) {
  if (!provider) return 'provider';
  if (PROVIDER_LABELS[provider]) return PROVIDER_LABELS[provider];
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// Pulled out so both the LLM and STT error paths (llm.js and stt.js) agree on
// what counts as a rate-limit/quota failure instead of drifting independently.
function isQuotaError(error) {
  const status = error && (error.status || error.statusCode || error.response?.status);
  const code = error && (error.code || error.error?.code);
  const rawMessage = (error && (error.message || String(error))) || '';
  const text = `${rawMessage} ${status || ''} ${code || ''}`.toLowerCase();
  return status === 429 || code === 429 || code === 'insufficient_quota' || code === 'rate_limit_exceeded' ||
    code === 'RESOURCE_EXHAUSTED' || /quota|billing|rate limit|exceeded your current quota|resource_exhausted|too many requests/i.test(text);
}

function isNotFoundError(error) {
  const status = error && (error.status || error.statusCode || error.response?.status);
  const code = error && (error.code || error.error?.code);
  const rawMessage = (error && (error.message || String(error))) || '';
  const text = `${rawMessage} ${status || ''} ${code || ''}`.toLowerCase();
  return status === 404 || code === 404 || /\b404\b|is not found for api version|model not found/i.test(text);
}

// Gemini 429 bodies often carry a google.rpc.RetryInfo detail like
// {"retryDelay":"38s"} inside the JSON error text. Not every quota error has
// one (OpenAI/Anthropic don't), so this is best-effort and returns null when
// absent instead of guessing a wait time.
function extractRetryDelaySeconds(rawMessage) {
  const match = /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)\s*s/i.exec(String(rawMessage || ''));
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function formatRetryWait(seconds) {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function formatProviderErrorMessage(error, provider, model) {
  const label = normalizeProviderName(provider);
  const rawMessage = (error && (error.message || String(error))) || '';

  if (isQuotaError(error)) {
    const retrySeconds = extractRetryDelaySeconds(rawMessage);
    const waitHint = retrySeconds ? ` Wait about ${formatRetryWait(retrySeconds)}` : ' Wait a moment';
    return `${label} free-tier quota exhausted (429 Too Many Requests).${waitHint} and try again, or add billing to your ${label} account. You can also switch providers or models in Settings.`;
  }

  if (isNotFoundError(error)) {
    const modelHint = model ? ` "${model}"` : '';
    return `${label} model${modelHint} is unavailable (404) — it may have been renamed, retired by the provider, or misspelled. Open Settings and pick a current model for ${label} (or clear the field to use cue's default), then try again.`;
  }

  return rawMessage || 'Unknown LLM error.';
}

function sanitizeTurns(turns) {
  const valid = new Set(['user', 'assistant']);
  return (turns || []).filter(t => valid.has(t.role)).map(t => ({ role: t.role, text: String(t.text || '') }));
}

// MiniMax is OpenAI-compatible and exposes two regional gateways. MiniMax-M3
// accepts image input, so it reuses the OpenAI screenshot path via baseURL.
const MINIMAX_BASE_URLS = {
  global_en: 'https://api.minimax.io/v1',
  cn_zh: 'https://api.minimaxi.com/v1'
};

function stripDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  return m ? { mime: m[1], b64: m[2] } : null;
}

// Text-only OpenAI-compatible endpoints (DeepSeek among them) reject the
// image_url content part outright, so a screenshot would fail the whole request
// rather than simply being ignored. Drop the image and answer from the
// transcript instead — a degraded answer beats an error mid-meeting.
function modelSupportsVision(model, provider) {
  return provider !== 'claudecli' && !/deepseek|qwen-?turbo|^text-|moonshot-v1-(8|32|128)k$|^(haiku|sonnet|opus)$/i.test(String(model || ''));
}

function appendToolCall(calls, delta) {
  for (const incoming of delta.tool_calls || []) {
    const index = incoming.index || 0;
    const call = calls[index] || (calls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } });
    if (incoming.id) call.id = incoming.id;
    if (incoming.type) call.type = incoming.type;
    if (incoming.function?.name) call.function.name += incoming.function.name;
    if (incoming.function?.arguments) call.function.arguments += incoming.function.arguments;
  }
}

async function consumeOpenAIStream(stream, { model, onToken, onActivity, onUsage }) {
  let full = '';
  const toolCalls = [];
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta || {};
    const text = delta.content;
    if (text) { full += text; onToken(text); }
    if (delta.tool_calls) appendToolCall(toolCalls, delta);
    if ((delta.reasoning_content || delta.tool_calls) && onActivity) onActivity();
    if (part.usage && onUsage) onUsage(normalizeUsage(part.usage, model));
  }
  return { full, toolCalls: toolCalls.filter(Boolean) };
}

function createOpenAIRequest({ model, messages, maxTokens, isDeepSeek, thinkingEnabled, mode, tools }) {
  const request = {
    model, messages, stream: true, max_tokens: maxTokens,
    // Providers omit usage from streamed responses unless asked, and without it
    // there is no way to tell the user what a session actually cost.
    stream_options: { include_usage: true },
  };
  if (tools) request.tools = tools;
  if (isDeepSeek) {
    request.thinking = { type: thinkingEnabled ? 'enabled' : 'disabled' };
    if (!thinkingEnabled) request.temperature = mode === 'leetcode' ? 0 : 1;
  }
  return request;
}

async function streamOpenAI({ apiKey, baseURL, model, system, turns, imageDataUrl, maxTokens, onToken, onActivity, onUsage, thinkingEnabled, mode, onToolCall }) {
  const supportsVision = modelSupportsVision(model);
  const OpenAI = require('openai');
  const client = new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
  const messages = [{ role: 'system', content: system }];
  turns.forEach((t, i) => {
    const last = i === turns.length - 1;
    if (last && imageDataUrl && supportsVision && t.role === 'user') {
      messages.push({
        role: 'user', content: [
          { type: 'text', text: t.text },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      });
    } else {
      messages.push({ role: t.role, content: t.text });
    }
  });
  const isDeepSeek = /deepseek/i.test(baseURL || '') || /^deepseek/i.test(model || '');
  const first = await consumeOpenAIStream(await client.chat.completions.create(createOpenAIRequest({
    model, messages, maxTokens, isDeepSeek, thinkingEnabled, mode, tools: onToolCall ? [SEARCH_FACTS_TOOL] : null
  })), { model, onToken, onActivity, onUsage });
  const toolCall = onToolCall && first.toolCalls.find((call) => call.function.name === 'search_facts');
  if (!toolCall) return first.full;

  let query = '';
  try { query = JSON.parse(toolCall.function.arguments || '{}').query || ''; } catch (_) {}
  const toolResult = await onToolCall(String(query), onActivity);
  messages.push({ role: 'assistant', content: first.full || null, tool_calls: [toolCall] });
  messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(toolResult || { summary: 'No result available.' }) });
  const final = await consumeOpenAIStream(await client.chat.completions.create(createOpenAIRequest({
    model, messages, maxTokens, isDeepSeek, thinkingEnabled, mode
  })), { model, onToken, onActivity, onUsage });
  return first.full + final.full;
}

// DeepSeek reports cache hits as prompt_cache_hit_tokens; OpenAI nests the same
// idea under prompt_tokens_details.cached_tokens. Normalise both so the caller
// does not care which provider it is talking to.
function normalizeUsage(usage, model) {
  const prompt = usage.prompt_tokens || 0;
  const cached = usage.prompt_cache_hit_tokens
    || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens)
    || 0;
  return {
    model,
    promptTokens: prompt,
    cachedTokens: cached,
    completionTokens: usage.completion_tokens || 0,
  };
}

// Azure AI Foundry Models API (cognitiveservices.azure.com hosts) lives under
// {endpoint}/openai/v1 and authenticates with the `api-key` header.
function normalizeAzureBaseURL(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  if (!u) return '';
  if (/cognitiveservices\.azure\.com/i.test(u) && !/\/openai\/v1$/i.test(u)) {
    u += '/openai/v1';
  }
  return u;
}

async function streamAzure({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, onUsage, endpoint }) {
  const url = normalizeAzureBaseURL(endpoint);
  if (!url) throw new Error('Missing Azure endpoint. Add your Azure AI Foundry or Azure OpenAI endpoint in Settings.');
  const messages = [{ role: 'system', content: system }];
  turns.forEach((t, i) => {
    const last = i === turns.length - 1;
    if (last && imageDataUrl && t.role === 'user') {
      messages.push({ role: 'user', content: [
        { type: 'text', text: t.text },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ] });
    } else {
      messages.push({ role: t.role, content: t.text });
    }
  });
  const OpenAI = require('openai');
  let client;
  if (/openai\.azure\.com/i.test(url)) {
    client = new OpenAI.AzureOpenAI({ endpoint: url.replace(/\/openai$/i, ''), apiKey, apiVersion: '2024-10-21' });
  } else {
    // Foundry / OpenAI-compatible base: force the `api-key` header and drop the
    // Authorization header the SDK adds by default (those hosts don't take a Bearer key).
    const azureFetch = async (input, init) => {
      const headers = new Headers(init && init.headers);
      headers.set('api-key', apiKey);
      headers.delete('authorization');
      return fetch(input, { ...init, headers });
    };
    client = new OpenAI({ baseURL: url, apiKey, fetch: azureFetch });
  }
  const stream = await client.chat.completions.create({
    model, messages, stream: true, max_completion_tokens: maxTokens,
    stream_options: { include_usage: true },
  });
  let full = '';
  for await (const part of stream) {
    const d = part.choices && part.choices[0] && part.choices[0].delta && part.choices[0].delta.content;
    if (d) { full += d; onToken(d); }
    if (part.usage && onUsage) onUsage(normalizeUsage(part.usage, model));
  }
  return full;
}

async function streamAnthropic({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, onUsage }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const messages = turns.map((t, i) => {
    const last = i === turns.length - 1;
    if (last && imageDataUrl && t.role === 'user') {
      const img = stripDataUrl(imageDataUrl);
      const content = [];
      if (img) content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } });
      content.push({ type: 'text', text: t.text });
      return { role: 'user', content };
    }
    return { role: t.role, content: t.text };
  });
  const stream = await client.messages.create({ model, max_tokens: maxTokens, system, messages, stream: true });
  let full = '';
  // Anthropic splits usage across two events: input counts on message_start,
  // the final output count on message_delta. Report once, after both have landed.
  const totals = { promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { full += ev.delta.text; onToken(ev.delta.text); }
    const u = (ev.type === 'message_start' && ev.message && ev.message.usage) || (ev.type === 'message_delta' && ev.usage) || null;
    if (u) {
      totals.promptTokens += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
      totals.cachedTokens += u.cache_read_input_tokens || 0;
      totals.completionTokens = u.output_tokens || totals.completionTokens;
    }
  }
  if (onUsage && (totals.promptTokens || totals.completionTokens)) onUsage({ model, ...totals });
  return full;
}

async function streamGemini({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, onUsage }) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const contents = turns.map((t, i) => {
    const last = i === turns.length - 1;
    const parts = [{ text: t.text }];
    if (last && imageDataUrl && t.role === 'user') {
      const img = stripDataUrl(imageDataUrl);
      if (img) parts.push({ inlineData: { mimeType: img.mime, data: img.b64 } });
    }
    return { role: t.role === 'assistant' ? 'model' : 'user', parts };
  });
  const stream = await ai.models.generateContentStream({
    model, contents, config: { systemInstruction: system, maxOutputTokens: maxTokens }
  });
  let full = '';
  // Gemini repeats cumulative counts on every chunk, so the last one seen is the
  // total. Reported once at the end rather than added up per chunk.
  let lastUsage = null;
  for await (const chunk of stream) {
    const t = chunk && chunk.text;
    if (t) { full += t; onToken(t); }
    if (chunk && chunk.usageMetadata) lastUsage = chunk.usageMetadata;
  }
  if (onUsage && lastUsage) {
    onUsage({
      model,
      promptTokens: lastUsage.promptTokenCount || 0,
      cachedTokens: lastUsage.cachedContentTokenCount || 0,
      completionTokens: lastUsage.candidatesTokenCount || 0,
    });
  }
  return full;
}

async function streamOllama({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken }) {
  const baseUrl = apiKey || 'http://localhost:11434';
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;

  const messages = [{ role: 'system', content: system }];
  turns.forEach((t, i) => {
    const last = i === turns.length - 1;
    if (last && imageDataUrl && t.role === 'user') {
      const img = stripDataUrl(imageDataUrl);
      if (img) {
        messages.push({ role: 'user', content: t.text, images: [img.b64] });
      } else {
        messages.push({ role: 'user', content: t.text });
      }
    } else {
      messages.push({ role: t.role, content: t.text });
    }
  });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true })
    });
  } catch (err) {
    throw new Error(`Ollama fetch failed: ${err.message}. Is Ollama running at ${baseUrl}?`);
  }

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.message && data.message.content) {
          full += data.message.content;
          onToken(data.message.content);
        }
      } catch (e) {
        // ignore
      }
    }
  }
  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer);
      if (data.message && data.message.content) {
        full += data.message.content;
        onToken(data.message.content);
      }
    } catch (e) { }
  }
  return full;
}

function textFromClaudeEvent(event) {
  if (event?.delta?.text) return event.delta.text;
  if (event?.type === 'assistant') {
    return (event.message?.content || []).filter((part) => part.type === 'text').map((part) => part.text || '').join('');
  }
  return event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' ? event.delta.text : '';
}

async function streamClaudeCli({ model, system, turns, onToken, onActivity, signal }) {
  const { spawn } = require('child_process');
  const prompt = ['=== SYSTEM ===', system, '=== CONVERSATION ===', ...(turns || []).map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`)].join('\n\n');
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('claude', ['-p', '--output-format', 'stream-json', '--model', model], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let full = '';
    let buffer = '';
    let stderr = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(full);
    };
    const consume = (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (onActivity) onActivity();
        const text = textFromClaudeEvent(event);
        if (text) { full += text; onToken(text); }
      } catch (_) {}
    };
    const abort = () => {
      child.kill();
      finish(new Error('Claude CLI stream aborted.'));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') return finish(new Error('Claude CLI is not installed or is not on PATH. Install Claude Code, then try again.'));
      finish(error);
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(consume);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      consume(buffer);
      if (code === 0) finish();
      else finish(new Error(`Claude CLI exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ''}`));
    });
    child.stdin.end(prompt);
  });
}

// forceTier lets a background task opt out of the Smart toggle. A reasoning model
// bills its thinking tokens, which is worth it for an answer the user is waiting
// on and pure waste for a bullet list nobody asked for.
function createLLM(settings, { forceTier } = {}) {
  const provider = settings.provider;
  const keys = settings.apiKeys || {};
  let apiKey = keys[provider];
  let baseURL = '';
  let configurationError = '';
  const tier = forceTier || (settings.smart ? 'smart' : 'fast');
  const models = settings.models || {};
  let model = (models[provider] || {})[tier];
  if (provider === 'gemini' && DEAD_GEMINI_MODEL_RE.test(model || '')) {
    model = CURRENT_GEMINI_DEFAULT;
  }
  if (DEAD_DEEPSEEK_MODEL_RE.test(model || '')) {
    model = CURRENT_DEEPSEEK_DEFAULT;
  }
  if (!model) model = DEFAULT_MODELS[provider] || '';
  const minimaxRegion = settings.minimaxRegion || 'global_en';
  const endpoint = settings.azureEndpoint || '';

  if (provider === CUSTOM_PROVIDER) {
    try {
      const clientOptions = createCompatibleClientOptions(apiKey, settings.baseUrl);
      apiKey = clientOptions.apiKey;
      baseURL = clientOptions.baseURL;
    } catch (error) {
      configurationError = error.message;
    }
    if (!model && !configurationError) {
      configurationError = 'Set a Fast or Smart model for the Custom provider.';
    }
  } else if (provider !== 'ollama' && provider !== 'claudecli' && !apiKey) {
    // Ollama is a local server: the field holds a URL, and no key is required.
    configurationError = `Add your ${provider} API key in Settings.`;
  }

  // Azure needs a second credential: the resource endpoint.
  if (!configurationError && provider === 'azure' && !endpoint) {
    configurationError = 'Add your Azure AI Foundry endpoint in Settings.';
  }

  const ready = !configurationError && !!model;
  const maxTokens = tier === 'smart' ? 1400 : 700;

  return {
    provider, model, apiKey, baseURL,
    ready,
    configurationError,
    async stream(params) {
      if (!ready) throw new Error(configurationError || `Complete the ${provider} provider settings.`);
      const args = { apiKey, baseURL, endpoint, model, maxTokens, thinkingEnabled: tier === 'smart', ...params, turns: sanitizeTurns(params.turns) };
      try {
        if (provider === 'openai') return await streamOpenAI(args);
        if (provider === CUSTOM_PROVIDER) return await streamOpenAI(args);
        if (provider === 'ollama') return await streamOllama(args);
        if (provider === 'groq') return await streamOpenAI({ ...args, baseURL: 'https://api.groq.com/openai/v1' });
        if (provider === 'minimax') return await streamOpenAI({ ...args, baseURL: MINIMAX_BASE_URLS[minimaxRegion] || MINIMAX_BASE_URLS.global_en });
        if (provider === 'anthropic') return await streamAnthropic(args);
        if (provider === 'gemini') return await streamGemini(args);
        if (provider === 'azure') return await streamAzure(args);
        if (provider === 'claudecli') return await streamClaudeCli(args);
        throw new Error('unknown provider: ' + provider);
      } catch (error) {
        throw new Error(formatProviderErrorMessage(error, provider, model));
      }
    }
  };
}

module.exports = { modelSupportsVision, createLLM, formatProviderErrorMessage, isQuotaError, CURRENT_GEMINI_DEFAULT, CURRENT_DEEPSEEK_DEFAULT, streamOpenAI, streamClaudeCli };
