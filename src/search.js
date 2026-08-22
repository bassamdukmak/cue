const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const SEC_TICKERS = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS = 'https://data.sec.gov/submissions/CIK';
const FEDERAL_REGISTER = 'https://www.federalregister.gov/api/v1/documents.json';
const FMP_BASE = 'https://financialmodelingprep.com/stable/';
let tickerCache = null;

function classify(query) {
  if (/\b(8-k|10-[qk]|20-f|40-f|sec filing|filed|filing|annual report|quarterly report)\b/i.test(query)) return 'filing';
  if (/\b(regulation|regulatory|rulemaking|final rule|proposed rule|federal register|agency action|effective date)\b/i.test(query)) return 'regulation';
  if (/\b(next week|next month|tomorrow|monday|tuesday|wednesday|thursday|friday|reports? (?:on|next|this)|earnings|cpi|fomc|fed meets?|economic (?:release|event))\b/i.test(query)) return 'event';
  if (/\b(revenue|earnings per share|eps|market cap|stock price|financial metric|margin|guidance|company profile|cash flow|balance sheet|income statement|news|headlines)\b/i.test(query)
    || /^(?:\$)?[A-Z]{1,5}$/.test(String(query).trim())) return 'metric';
  return 'general';
}

function tickerFrom(query, tickers) {
  const explicit = /\b(?:NYSE|NASDAQ)\s*:?\s*([A-Z]{1,5})\b/.exec(query) || /\$([A-Z]{1,5})\b/.exec(query);
  if (explicit) return explicit[1];
  const naked = /(?:^|[\s($])([A-Z]{1,5})(?=$|[\s).,?!])/.exec(query);
  if (naked) return naked[1];
  const name = String(query).split(/\b(?:file|report|earnings|revenue|regulation|rule)\b/i)[0]
    .replace(/\b(did|does|has|have|will|company|the|a|an)\b/gi, ' ').trim().toLowerCase();
  return tickers.find((row) => String(row.title || '').toLowerCase().startsWith(name))?.ticker || null;
}

async function json(fetchImpl, url, { timeoutMs, headers, ...init }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, headers, signal: controller.signal });
    return response.ok ? response.json() : null;
  } catch (_) { return null; } finally { clearTimeout(timer); }
}

async function wikipedia(query, options) {
  const url = new URL(WIKIPEDIA_API);
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, format: 'json', origin: '*' });
  const title = (await json(options.fetchImpl, url, options))?.query?.search?.[0]?.title;
  if (!title) return null;
  const page = await json(options.fetchImpl, WIKIPEDIA_SUMMARY + encodeURIComponent(title.replace(/ /g, '_')), options);
  return page?.extract ? { summary: page.extract, source: 'Wikipedia', url: page.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` } : null;
}

async function edgar(query, options) {
  const headers = { 'User-Agent': 'cue-meeting-assistant (contact: user)', Accept: 'application/json' };
  tickerCache ||= await json(options.fetchImpl, SEC_TICKERS, { ...options, headers });
  const rows = tickerCache && Object.values(tickerCache);
  const ticker = rows && tickerFrom(query, rows);
  const company = rows?.find((row) => row.ticker === ticker);
  if (!company?.cik_str) return null;
  const cik = String(company.cik_str).padStart(10, '0');
  const filings = await json(options.fetchImpl, `${SEC_SUBMISSIONS}${cik}.json`, { ...options, headers });
  const recent = filings?.filings?.recent;
  const wanted = /\b(8-k|10-[qk]|20-f|40-f)\b/i.exec(query)?.[1]?.toUpperCase()
    || (/annual report/i.test(query) ? '10-K' : /quarterly report/i.test(query) ? '10-Q' : null);
  const index = recent?.form?.findIndex((form) => wanted ? form.toUpperCase() === wanted : /^(8-K|10-[QK]|20-F|40-F)$/i.test(form));
  if (index == null || index < 0) return null;
  const form = recent.form[index], date = recent.filingDate[index], accession = recent.accessionNumber?.[index]?.replace(/-/g, '');
  return { summary: `${company.title} (${company.ticker}) filed ${form} on ${date}.`, source: 'SEC EDGAR', url: accession ? `https://www.sec.gov/Archives/edgar/data/${company.cik_str}/${accession}/` : `https://data.sec.gov/submissions/CIK${cik}.json` };
}

function federalResult(row) {
  if (!row?.title) return null;
  const date = row.effective_on || row.publication_date || row.signing_date;
  return { summary: `${row.title}${date ? ` — ${row.type || 'document'}${row.effective_on ? `; effective ${date}` : `; published ${date}`}` : ''}.`, source: 'Federal Register', url: row.html_url || row.pdf_url || null };
}

async function federalRegister(query, options) {
  const url = new URL(FEDERAL_REGISTER);
  url.search = new URLSearchParams({ per_page: '5', order: 'newest', 'conditions[term]': query });
  return federalResult((await json(options.fetchImpl, url, options))?.results?.[0]);
}

function dateRange() { const from = new Date(), to = new Date(from.getTime() + 14 * 86400000); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; }
async function fmpCalendar(query, options) {
  const { from, to } = dateRange(), kind = /earnings|report/i.test(query) ? 'earnings-calendar' : 'economic-calendar';
  const url = new URL(FMP_BASE + kind); url.search = new URLSearchParams({ from, to, apikey: options.apiKeys.fmp });
  const rows = await json(options.fetchImpl, url, options);
  const ticker = tickerFrom(query, []);
  const term = /\bcpi\b/i.test(query) ? 'cpi' : /\b(fomc|fed)\b/i.test(query) ? 'fed' : '';
  const row = rows?.find((item) => ticker ? item.symbol === ticker : term && new RegExp(term, 'i').test(`${item.event || ''} ${item.name || ''}`));
  return row ? { summary: `${row.symbol || row.event || row.name || 'Event'} is scheduled for ${row.date || row.datetime || 'the requested period'}.`, source: 'FMP Calendar', url: `https://financialmodelingprep.com/developer/docs/stable/${kind}` } : null;
}
async function fmpMetric(query, options) {
  const ticker = tickerFrom(query, []); if (!ticker) return null;
  const url = new URL(FMP_BASE + 'profile'); url.search = new URLSearchParams({ symbol: ticker, apikey: options.apiKeys.fmp });
  const metricsUrl = new URL(FMP_BASE + 'key-metrics-ttm'); metricsUrl.search = new URLSearchParams({ symbol: ticker, apikey: options.apiKeys.fmp });
  const row = (await json(options.fetchImpl, url, options))?.[0];
  const metrics = (await json(options.fetchImpl, metricsUrl, options))?.[0];
  return row || metrics ? { summary: `${row?.companyName || ticker}: market cap ${row?.mktCap ?? 'unavailable'}, price ${row?.price ?? 'unavailable'}, operating margin ${metrics?.operatingProfitMarginTTM ?? 'unavailable'}.`, source: 'FMP', url: row?.website || 'https://financialmodelingprep.com/developer/docs/stable/profile' } : null;
}
async function finnhubMetric(query, options) {
  const ticker = tickerFrom(query, []); if (!ticker) return null;
  const news = /\b(news|headlines?)\b/i.test(query);
  const endpoint = news ? 'company-news' : 'stock/metric';
  const url = new URL(`https://finnhub.io/api/v1/${endpoint}`);
  const params = { symbol: ticker, token: options.apiKeys.finnhub };
  if (news) Object.assign(params, { from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  else params.metric = 'all';
  url.search = new URLSearchParams(params);
  const body = await json(options.fetchImpl, url, options);
  const row = news ? body?.[0] : body?.metric;
  const summary = news ? row?.headline : [body?.companyName, row?.marketCapitalization != null && `market cap ${row.marketCapitalization}`, row?.netProfitMarginTTM != null && `margin ${Number(row.netProfitMarginTTM).toFixed(2)}%`].filter(Boolean).join(': ');
  return summary ? { summary, source: 'Finnhub', url: `https://finnhub.io/api/v1/${endpoint}?symbol=${encodeURIComponent(ticker)}` } : null;
}
async function brave(query, options) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search'); url.search = new URLSearchParams({ q: query });
  const row = (await json(options.fetchImpl, url, { ...options, headers: { 'X-Subscription-Token': options.apiKeys.brave, Accept: 'application/json' } }))?.web?.results?.[0];
  return row?.description ? { summary: row.description, source: 'Brave Search', url: row.url } : null;
}
async function tavily(query, options) {
  const payload = await json(options.fetchImpl, 'https://api.tavily.com/search', { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: options.apiKeys.tavily, query, max_results: 1 }) });
  const row = payload?.results?.[0]; return row?.content ? { summary: row.content, source: 'Tavily', url: row.url } : null;
}

function liveSearchSources(apiKeys = {}) { return ['Wikipedia', 'SEC EDGAR', 'Federal Register', ...(apiKeys.fmp ? ['FMP'] : []), ...(apiKeys.finnhub ? ['Finnhub'] : []), ...(apiKeys.brave ? ['Brave'] : []), ...(apiKeys.tavily ? ['Tavily'] : [])]; }
async function searchFacts(query, { fetchImpl = fetch, timeoutMs = 5000, apiKeys = {} } = {}) {
  const text = String(query || '').trim(); if (!text) return null;
  const options = { fetchImpl, timeoutMs, apiKeys }, type = classify(text);
  const general = [wikipedia, apiKeys.brave && brave, apiKeys.tavily && tavily].filter(Boolean);
  const financial = [apiKeys.fmp && fmpMetric, apiKeys.finnhub && finnhubMetric].filter(Boolean);
  const sources = type === 'filing' ? [edgar, wikipedia] : type === 'regulation' ? [federalRegister, wikipedia]
    : type === 'event' && apiKeys.fmp ? [fmpCalendar, wikipedia] : type === 'metric' ? (financial.length ? [...financial, wikipedia] : general) : general;
  for (const source of sources.slice(0, 2)) { const result = await source(text, options); if (result) return result; }
  return null;
}

module.exports = { searchFacts, liveSearchSources, getConfiguredSources: liveSearchSources, _internals: { classify, federalResult, tickerFrom, resetTickerCache: () => { tickerCache = null; } } };
