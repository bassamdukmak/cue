const assert = require('node:assert/strict');
const test = require('node:test');
const { searchFacts, _internals } = require('../src/search');

test('Wikipedia search returns a normalized fact without using the network in tests', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return { ok: true, json: async () => ({ query: { search: [{ title: 'Apollo 11' }] } }) };
    return { ok: true, json: async () => ({ extract: 'Apollo 11 landed on the Moon.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Apollo_11' } } }) };
  };
  assert.deepEqual(await searchFacts('moon landing', { fetchImpl }), {
    summary: 'Apollo 11 landed on the Moon.', source: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Apollo_11'
  });
  assert.equal(calls.length, 2);
});

test('Wikipedia timeout and failures return null', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  assert.equal(await searchFacts('slow fact', { fetchImpl, timeoutMs: 1 }), null);
  assert.equal(await searchFacts('nope', { fetchImpl: async () => ({ ok: false }), timeoutMs: 20 }), null);
});

test('financial queries use FMP first when its optional key is configured', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes('/profile')) return { ok: true, json: async () => ([{ companyName: 'Apple Inc.', mktCap: 1000 }]) };
    if (value.includes('/key-metrics-ttm')) return { ok: true, json: async () => ([{ operatingProfitMarginTTM: 25, revenuePerShareTTM: 10 }]) };
    throw new Error('Wikipedia must not be reached');
  };
  const result = await searchFacts('AAPL revenue and margin', { apiKeys: { fmp: 'test-fmp-key' }, fetchImpl });
  assert.equal(result.source, 'FMP');
  assert.match(result.summary, /Apple Inc/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.includes('financialmodelingprep.com')));
});

test('financial queries fall back to Wikipedia when no financial key is configured', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return { ok: true, json: async () => ({ query: { search: [{ title: 'Apple Inc.' }] } }) };
    return { ok: true, json: async () => ({ extract: 'Apple is a company.', content_urls: { desktop: { page: 'https://example.test/apple' } } }) };
  };
  const result = await searchFacts('AAPL revenue', { fetchImpl });
  assert.equal(result.source, 'Wikipedia');
  assert.equal(calls.length, 2);
});

for (const [name, query, apiKeys] of [
  ['FMP', 'AAPL revenue', { fmp: 'key' }],
  ['Finnhub', 'AAPL revenue', { finnhub: 'key' }],
  ['Brave', 'who is Ada Lovelace', { brave: 'key' }],
  ['Tavily', 'who is Ada Lovelace', { tavily: 'key' }],
]) {
  test(`${name} failure returns null without throwing`, async () => {
    assert.equal(await searchFacts(query, { apiKeys, fetchImpl: async () => ({ ok: false }) }), null);
  });
}

test('EDGAR resolves a ticker fixture, includes its required identity header, and shapes a filing', async () => {
  _internals.resetTickerCache();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    if (String(url).includes('company_tickers')) return { ok: true, json: async () => ({ 0: { ticker: 'AAPL', title: 'Apple Inc.', cik_str: 320193 } }) };
    return { ok: true, json: async () => ({ filings: { recent: { form: ['10-Q'], filingDate: ['2026-08-01'], accessionNumber: ['0000320193-26-000001'] } } }) };
  };
  assert.deepEqual(await searchFacts('Did Apple file a 10-Q?', { fetchImpl }), {
    summary: 'Apple Inc. (AAPL) filed 10-Q on 2026-08-01.', source: 'SEC EDGAR',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/'
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].headers['User-Agent'], /cue-meeting-assistant/);
  assert.match(calls[1].headers['User-Agent'], /contact: user/);
});

test('Federal Register route shapes authoritative regulatory results', async () => {
  const calls = [];
  const result = await searchFacts('What is the effective date of this regulation?', {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ results: [{ title: 'Clean Air Rule', type: 'Rule', effective_on: '2026-09-01', html_url: 'https://www.federalregister.gov/d/2026-1' }] }) };
    }
  });
  assert.deepEqual(result, { summary: 'Clean Air Rule — Rule; effective 2026-09-01.', source: 'Federal Register', url: 'https://www.federalregister.gov/d/2026-1' });
  assert.match(calls[0], /federalregister\.gov/);
});

test('routing prefers EDGAR for filings and Federal Register for regulations', async () => {
  _internals.resetTickerCache();
  const filingCalls = [];
  await searchFacts('Apple filed an 8-K', { fetchImpl: async (url) => {
    filingCalls.push(String(url));
    if (String(url).includes('company_tickers')) return { ok: true, json: async () => ({ 0: { ticker: 'AAPL', title: 'Apple Inc.', cik_str: 320193 } }) };
    return { ok: true, json: async () => ({ filings: { recent: { form: ['8-K'], filingDate: ['2026-08-01'], accessionNumber: ['1-2'] } } }) };
  } });
  const regulationCalls = [];
  await searchFacts('This proposed rule changes reporting', { fetchImpl: async (url) => {
    regulationCalls.push(String(url));
    return { ok: true, json: async () => ({ results: [{ title: 'Rule', html_url: 'https://example.test/rule' }] }) };
  } });
  assert.match(filingCalls[0], /sec\.gov/);
  assert.match(regulationCalls[0], /federalregister\.gov/);
});

test('source failures always resolve to null', async () => {
  const fail = async () => ({ ok: false });
  _internals.resetTickerCache();
  assert.equal(await searchFacts('Apple filed an 8-K', { fetchImpl: fail }), null);
  assert.equal(await searchFacts('proposed regulation', { fetchImpl: fail }), null);
  assert.equal(await searchFacts('CPI comes out Friday', { fetchImpl: fail, apiKeys: { fmp: 'key' } }), null);
  assert.equal(await searchFacts('$AAPL revenue', { fetchImpl: fail, apiKeys: { fmp: 'key', finnhub: 'key' } }), null);
  assert.equal(await searchFacts('ordinary fact', { fetchImpl: fail, apiKeys: { brave: 'key' } }), null);
  assert.equal(await searchFacts('ordinary fact', { fetchImpl: fail, apiKeys: { tavily: 'key' } }), null);
});
