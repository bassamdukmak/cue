const assert = require('node:assert/strict');
const test = require('node:test');
const { searchFacts, liveSearchSources, _internals } = require('../src/search');

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

test('new key-free parsers shape fixtures and reject malformed data', () => {
  const parsers = [
    [_internals.wikidataResult, { id: 'Q1', labels: { en: { value: 'Universe' } }, descriptions: { en: { value: 'totality of space' } } }, 'Wikidata'],
    [_internals.openAlexResult, { title: 'A study', doi: 'https://doi.org/1', cited_by_count: 3 }, 'OpenAlex'],
    [_internals.crossrefResult, { title: ['A paper'], DOI: '1/x' }, 'Crossref'],
    [_internals.arxivResult, '<entry><title>A preprint</title><id>https://arxiv.org/abs/1</id><summary>Abstract</summary></entry>', 'arXiv'],
    [_internals.pubmedResult, { title: 'Clinical result', articleids: [{ idtype: 'pubmed', value: '123' }] }, 'PubMed'],
    [_internals.worldBankResult, { country: { value: 'Canada' }, indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP' }, value: 2, date: '2025' }, 'World Bank'],
    [_internals.duckDuckGoResult, { AbstractText: 'Instant answer', AbstractURL: 'https://example.test' }, 'DuckDuckGo Instant Answer'],
    [_internals.searxngResult, { content: 'Self-hosted result', url: 'https://example.test' }, 'SearXNG'],
  ];
  for (const [parser, fixture, source] of parsers) {
    assert.equal(parser(fixture).source, source);
    assert.equal(parser(parser === _internals.arxivResult ? '' : {}), null);
  }
});

test('meeting-claim parsers shape fixtures and reject malformed data', () => {
  const parsers = [
    [_internals.githubResult, { full_name: 'owner/repo', stargazers_count: 2, html_url: 'https://github.test/owner/repo' }, 'GitHub'],
    [_internals.npmResult, { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} }, time: { '1.0.0': '2026-08-22' } }, 'npm', 'react'],
    [_internals.pypiResult, { info: { name: 'requests', version: '1.0', package_url: 'https://pypi.test/requests' }, releases: { '1.0': [{ upload_time_iso_8601: '2026-08-22T00:00:00Z' }] } }, 'PyPI', 'requests'],
    [_internals.eolResult, [{ cycle: '18', eol: '2026-04-30' }], 'endoflife.date', 'nodejs', 'node 18'],
    [_internals.osvResult, { vulns: [{ id: 'GHSA-test' }] }, 'OSV.dev', 'react', '1.0.0'],
    [_internals.stackExchangeResult, { title: 'How?', link: 'https://stackoverflow.test/q' }, 'Stack Exchange'],
    [_internals.awsResult, { products: { x: { sku: 'x', attributes: { servicecode: 'AmazonEC2', productFamily: 'Compute' } } }, terms: { OnDemand: { x: { sku: 'x', priceDimensions: { x: { pricePerUnit: { USD: '0.1' }, unit: 'Hrs' } } } } } }, 'AWS Pricing', 'AmazonEC2'],
    [_internals.ietfResult, { name: 'rfc9110', title: 'HTTP Semantics' }, 'IETF Datatracker', '9110'],
    [_internals.blsResult, { Results: { series: [{ data: [{ value: '3.2', periodName: 'July', year: '2026' }] }] } }, 'US Bureau of Labor Statistics', 'LNS14000000'],
    [_internals.owidResult, 'Entity,Year,Value\nWorld,2025,8.2', 'Our World in Data', 'co2-emissions-per-capita'],
  ];
  for (const [parser, fixture, source, ...args] of parsers) {
    assert.equal(parser(fixture, ...args).source, source);
    assert.equal(parser({}, ...args), null);
  }
});

test('new key-free routes select their specialist source first', async () => {
  const cases = [
    ['Did the launch happen recently?', 'api.gdeltproject.org', 'GDELT', (url) => ({ articles: [{ title: 'Recent launch', url: 'https://news.test' }] })],
    ['weather in Toronto', 'geocoding-api.open-meteo.com', 'Open-Meteo', (url) => String(url).includes('geocoding-api') ? { results: [{ name: 'Toronto', latitude: 43.7, longitude: -79.4 }] } : { current: { temperature_2m: 20 }, latitude: 43.7, longitude: -79.4 }],
    ['Canada capital and currency', 'restcountries.com', 'REST Countries', () => [{ name: { common: 'Canada' }, capital: ['Ottawa'], currencies: { CAD: { name: 'Canadian dollar' } } }]],
    ['where is Toronto?', 'nominatim.openstreetmap.org', 'OpenStreetMap Nominatim', () => [{ display_name: 'Toronto, Canada', lat: '43.7', lon: '-79.4' }]],
    ['bitcoin market cap', 'api.coingecko.com', 'CoinGecko', () => ({ bitcoin: { usd: 100, usd_market_cap: 1000 } })],
    ['USD to CAD exchange rate', 'api.frankfurter.app', 'Frankfurter', () => ({ rates: { CAD: 1.5 }, date: '2026-08-22' })],
    ['their site used to say this: https://example.test on 2020-01-01', 'archive.org', 'Wayback Machine', () => ({ archived_snapshots: { closest: { available: true, url: 'https://web.archive.org/test' } } })],
    ['tech industry product launch', 'hn.algolia.com', 'Hacker News', () => ({ hits: [{ title: 'Launch', url: 'https://news.ycombinator.com/item?id=1' }] })],
  ];
  for (const [query, host, source, body] of cases) {
    const calls = [];
    const result = await searchFacts(query, { fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return { ok: true, json: async () => body(url) };
    } });
    assert.equal(result.source, source);
    assert.match(calls[0].url, new RegExp(host.replace(/\./g, '\\.')));
    if (source === 'OpenStreetMap Nominatim') assert.match(calls[0].options.headers['User-Agent'], /cue-meeting-assistant/);
  }
});

test('new meeting-claim routes select their specialist source first', async () => {
  const cases = [
    ['npm package react', 'registry.npmjs.org', 'npm', () => ({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} }, time: {} })],
    ['PyPI package requests', 'pypi.org', 'PyPI', () => ({ info: { name: 'requests', version: '1.0' }, releases: { '1.0': [{}] } })],
    ['is node 18 end of life', 'endoflife.date', 'endoflife.date', () => [{ cycle: '18', eol: '2026-04-30' }]],
    ['is npm package react 1.0.0 insecure CVE', 'api.osv.dev', 'OSV.dev', () => ({ vulns: [] })],
    ['Stack Overflow technical consensus how does promises work', 'api.stackexchange.com', 'Stack Exchange', () => ({ items: [{ title: 'Promises', link: 'https://stackoverflow.test/q' }] })],
    ['AWS EC2 pricing cost', 'pricing.us-east-1.amazonaws.com', 'AWS Pricing', (url) => String(url).endsWith('index.json') ? { offers: { AmazonEC2: { currentRegionIndexUrl: '/offer.json' } } } : { products: { x: { sku: 'x', attributes: { servicecode: 'AmazonEC2', productFamily: 'Compute' } } }, terms: { OnDemand: { x: { sku: 'x', priceDimensions: { x: { pricePerUnit: { USD: '0.1' }, unit: 'Hrs' } } } } } }],
    ['RFC 9110 spec', 'datatracker.ietf.org', 'IETF Datatracker', () => ({ objects: [{ name: 'rfc9110', title: 'HTTP Semantics' }] })],
    ['US unemployment employment rate', 'api.bls.gov', 'US Bureau of Labor Statistics', () => ({ Results: { series: [{ data: [{ value: '3.2', periodName: 'July', year: '2026' }] }] } })],
    ['global CO2 emissions statistic', 'ourworldindata.org', 'Our World in Data', () => 'Entity,Year,Value\nWorld,2025,8.2'],
    ['is owner/repo abandoned', 'api.github.com', 'GitHub', () => ({ full_name: 'owner/repo', html_url: 'https://github.test/owner/repo', archived: true })],
  ];
  for (const [query, host, source, body] of cases) {
    const calls = [];
    const result = await searchFacts(query, { fetchImpl: async (url) => {
      calls.push(String(url)); const value = body(url);
      return { ok: true, json: async () => value, text: async () => typeof value === 'string' ? value : JSON.stringify(value) };
    } });
    assert.equal(result.source, source);
    assert.match(calls[0], new RegExp(host.replace(/\./g, '\\.')));
  }
});

test('GitHub uses its optional token without exposing it in the result', async () => {
  let headers;
  const result = await searchFacts('owner/repo repository', { apiKeys: { github: 'test-token' }, fetchImpl: async (_url, init) => {
    headers = init.headers;
    return { ok: true, json: async () => ({ full_name: 'owner/repo', html_url: 'https://github.test/owner/repo' }) };
  } });
  assert.equal(result.source, 'GitHub');
  assert.equal(headers.Authorization, 'Bearer test-token');
  assert.doesNotMatch(result.summary, /test-token/);
});

test('key-free routing selects the first specialist source for each claim type', async () => {
  const cases = [
    ['A study showed sleep helps memory', 'api.openalex.org', { results: [{ title: 'Sleep study', id: 'https://openalex.org/W1' }] }, 'OpenAlex'],
    ['What medical treatment helps asthma?', 'eutils.ncbi.nlm.nih.gov', { esearchresult: { idlist: ['1'] } }, 'PubMed'],
    ['Canada GDP', 'api.worldbank.org', [{}, [{ country: { value: 'Canada' }, indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP' }, value: 2, date: '2025' }]], 'World Bank'],
    ['Who is Ada Lovelace?', 'www.wikidata.org', { search: [{ id: 'Q7259' }] }, 'Wikidata'],
  ];
  for (const [query, host, body, source] of cases) {
    const calls = [];
    const result = await searchFacts(query, { fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('esummary')) return { ok: true, json: async () => ({ result: { 1: { title: 'Asthma result', articleids: [{ idtype: 'pubmed', value: '1' }] } } }) };
      if (String(url).includes('wbgetentities')) return { ok: true, json: async () => ({ entities: { Q7259: { id: 'Q7259', labels: { en: { value: 'Ada Lovelace' } } } } }) };
      return { ok: true, json: async () => body };
    } });
    assert.equal(result.source, source);
    assert.match(calls[0], new RegExp(host.replace(/\./g, '\\.')));
  }
});

test('DuckDuckGo follows Wikipedia and SearXNG is skipped unless configured', async () => {
  const calls = [];
  await searchFacts('ordinary fact', { fetchImpl: async (url) => {
    calls.push(String(url));
    if (String(url).includes('wikipedia.org')) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ AbstractText: 'Instant answer' }) };
  } });
  assert.match(calls[0], /wikipedia\.org/);
  assert.ok(calls.some((url) => url.includes('duckduckgo.com')));
  assert.ok(calls.every((url) => !url.includes('/search?')));
  assert.equal(liveSearchSources({}, '').includes('SearXNG'), false);
});

test('configured SearXNG is used only after Wikipedia fails', async () => {
  const calls = [];
  const result = await searchFacts('ordinary fact', { searxngUrl: 'http://localhost:8080', fetchImpl: async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => String(url).includes('localhost:8080') ? { results: [{ content: 'Local result', url: 'https://example.test' }] } : {} };
  } });
  assert.equal(result.source, 'SearXNG');
  assert.match(calls[0], /wikipedia\.org/);
  assert.match(calls[1], /localhost:8080/);
});
