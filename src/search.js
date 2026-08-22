const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const SEC_TICKERS = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS = 'https://data.sec.gov/submissions/CIK';
const FEDERAL_REGISTER = 'https://www.federalregister.gov/api/v1/documents.json';
const FMP_BASE = 'https://financialmodelingprep.com/stable/';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const OPENALEX_WORKS = 'https://api.openalex.org/works';
const ARXIV_API = 'http://export.arxiv.org/api/query';
const CROSSREF_WORKS = 'https://api.crossref.org/works';
const PUBMED_API = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const WORLD_BANK_API = 'https://api.worldbank.org/v2/country/';
let tickerCache = null;

function classify(query) {
  if (/\b(8-k|10-[qk]|20-f|40-f|sec filing|filed|filing|annual report|quarterly report)\b/i.test(query)) return 'filing';
  if (/\b(regulation|regulatory|rulemaking|final rule|proposed rule|federal register|agency action|effective date)\b/i.test(query)) return 'regulation';
  if (/\b(next week|next month|tomorrow|monday|tuesday|wednesday|thursday|friday|reports? (?:on|next|this)|earnings|cpi|fomc|fed meets?|economic (?:release|event))\b/i.test(query)) return 'event';
  if (/\b(revenue|earnings per share|eps|market cap|stock price|financial metric|margin|guidance|company profile|cash flow|balance sheet|income statement|news|headlines)\b/i.test(query)
    || /^(?:\$)?[A-Z]{1,5}$/.test(String(query).trim())) return 'metric';
  if (/\b(doctor|medical|medicine|health|disease|patient|clinical|drug|treatment|therapy|diagnosis|vaccine|cancer)\b/i.test(query)) return 'medical';
  if (/\b(study|studies|research|paper|journal|citation|citations|doi|published)\b/i.test(query)) return 'research';
  if (countryCode(query) && /\b(gdp|gross domestic product|unemployment|inflation|economic growth|gdp growth|population)\b/i.test(query)) return 'country';
  if (/\b(who is|when was|founder|founded|founding|population|parent company|date of birth|office holder)\b/i.test(query)) return 'fact';
  return 'general';
}

function countryCode(query) {
  const text = String(query || '').toLowerCase();
  const countries = { argentina: 'ARG', australia: 'AUS', brazil: 'BRA', canada: 'CAN', china: 'CHN', france: 'FRA', germany: 'DEU', india: 'IND', indonesia: 'IDN', italy: 'ITA', japan: 'JPN', mexico: 'MEX', nigeria: 'NGA', pakistan: 'PAK', russia: 'RUS', 'south africa': 'ZAF', 'south korea': 'KOR', spain: 'ESP', turkey: 'TUR', uk: 'GBR', 'united kingdom': 'GBR', 'united states': 'USA', usa: 'USA' };
  return Object.entries(countries).find(([name]) => new RegExp('\\b' + name + '\\b', 'i').test(text))?.[1]
    || (/\bUS\b/.test(String(query || '')) ? 'USA' : null)
    || /\b([A-Z]{3})\b/.exec(String(query || ''))?.[1] || null;
}

function worldBankIndicator(query) {
  if (/unemployment/i.test(query)) return 'SL.UEM.TOTL.ZS';
  if (/inflation/i.test(query)) return 'FP.CPI.TOTL.ZG';
  if (/economic growth|gdp growth/i.test(query)) return 'NY.GDP.MKTP.KD.ZG';
  if (/population/i.test(query)) return 'SP.POP.TOTL';
  return 'NY.GDP.MKTP.CD';
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

function wikidataResult(entity) {
  if (!entity?.labels?.en?.value) return null;
  const values = entity.claims || {};
  const value = (property) => values[property]?.[0]?.mainsnak?.datavalue?.value;
  const date = value('P571')?.time?.slice(1, 11);
  const population = value('P1082')?.amount;
  const facts = [date && 'founded ' + date, population && 'population ' + population].filter(Boolean);
  return { summary: [entity.labels.en.value, entity.descriptions?.en?.value, ...facts].filter(Boolean).join(' — '), source: 'Wikidata', url: 'https://www.wikidata.org/wiki/' + entity.id };
}
async function wikidata(query, options) {
  const url = new URL(WIKIDATA_API);
  url.search = new URLSearchParams({ action: 'wbsearchentities', search: query, language: 'en', format: 'json', origin: '*' });
  const id = (await json(options.fetchImpl, url, options))?.search?.[0]?.id;
  if (!id) return null;
  const entityUrl = new URL(WIKIDATA_API);
  entityUrl.search = new URLSearchParams({ action: 'wbgetentities', ids: id, languages: 'en', format: 'json', origin: '*' });
  return wikidataResult((await json(options.fetchImpl, entityUrl, options))?.entities?.[id]);
}

function openAlexResult(work) {
  if (!work?.title) return null;
  const cited = work.cited_by_count != null ? ' Cited ' + work.cited_by_count + ' times.' : '';
  return { summary: work.title + (work.publication_date ? ' (' + work.publication_date + ')' : '') + '.' + cited, source: 'OpenAlex', url: work.doi || work.id || null };
}
async function openAlex(query, options) {
  const url = new URL(OPENALEX_WORKS);
  url.search = new URLSearchParams({ search: query, per_page: '1', mailto: 'cue@localhost' });
  return openAlexResult((await json(options.fetchImpl, url, options))?.results?.[0]);
}

function crossrefResult(work) {
  if (!work?.title?.[0]) return null;
  const published = work.published?.['date-parts']?.[0]?.join('-');
  return { summary: work.title[0] + (published ? ' (' + published + ')' : '') + '.', source: 'Crossref', url: work.URL || (work.DOI && 'https://doi.org/' + work.DOI) || null };
}
async function crossref(query, options) {
  const url = new URL(CROSSREF_WORKS); url.search = new URLSearchParams({ query, rows: '1' });
  return crossrefResult((await json(options.fetchImpl, url, options))?.message?.items?.[0]);
}

function xmlText(xml, tag) { return new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(xml)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || ''; }
function arxivResult(xml) {
  const title = xmlText(xml, 'title'), id = xmlText(xml, 'id'), summary = xmlText(xml, 'summary');
  return title && id ? { summary: title + (summary ? ' — ' + summary : ''), source: 'arXiv', url: id } : null;
}
async function arxiv(query, options) {
  const url = new URL(ARXIV_API); url.search = new URLSearchParams({ search_query: 'all:' + query, start: '0', max_results: '1' });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url, { signal: controller.signal });
    return response.ok ? arxivResult(await response.text()) : null;
  } catch (_) { return null; } finally { clearTimeout(timer); }
}

function pubmedResult(record) {
  if (!record?.title) return null;
  const id = record.articleids?.find((item) => item.idtype === 'pubmed')?.value;
  return { summary: record.title + (record.pubdate ? ' (' + record.pubdate + ')' : '') + '.', source: 'PubMed', url: id ? 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/' : null };
}
async function pubmed(query, options) {
  const searchUrl = new URL(PUBMED_API + 'esearch.fcgi'); searchUrl.search = new URLSearchParams({ db: 'pubmed', term: query, retmax: '1', retmode: 'json' });
  const id = (await json(options.fetchImpl, searchUrl, options))?.esearchresult?.idlist?.[0];
  if (!id) return null;
  const summaryUrl = new URL(PUBMED_API + 'esummary.fcgi'); summaryUrl.search = new URLSearchParams({ db: 'pubmed', id, retmode: 'json' });
  return pubmedResult((await json(options.fetchImpl, summaryUrl, options))?.result?.[id]);
}

function worldBankResult(row) {
  if (row?.value == null) return null;
  return { summary: (row.country?.value || 'Country') + ' ' + (row.indicator?.value || 'indicator') + ': ' + row.value + ' (' + row.date + ').', source: 'World Bank', url: 'https://data.worldbank.org/indicator/' + (row.indicator?.id || '') };
}
async function worldBank(query, options) {
  const country = countryCode(query); if (!country) return null;
  const url = new URL(WORLD_BANK_API + country + '/indicator/' + worldBankIndicator(query)); url.search = new URLSearchParams({ format: 'json', per_page: '1' });
  return worldBankResult((await json(options.fetchImpl, url, options))?.[1]?.[0]);
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

function searxngResult(row) {
  if (!row?.content && !row?.title) return null;
  return { summary: row.content || row.title, source: 'SearXNG', url: row.url || null };
}
async function searxng(query, options) {
  if (!options.searxngUrl) return null;
  const url = new URL(options.searxngUrl.replace(/\/+$/, '') + '/search');
  url.search = new URLSearchParams({ q: query, format: 'json' });
  return searxngResult((await json(options.fetchImpl, url, options))?.results?.[0]);
}

// Instant answers only, never web results; keep this as the final fallback.
function duckDuckGoResult(body) {
  const row = body?.RelatedTopics?.find((item) => item?.Text) || body?.RelatedTopics?.flatMap((item) => item?.Topics || []).find((item) => item?.Text);
  const summary = body?.AbstractText || row?.Text;
  return summary ? { summary, source: 'DuckDuckGo Instant Answer', url: body?.AbstractURL || row?.FirstURL || null } : null;
}
async function duckDuckGo(query, options) {
  const url = new URL('https://api.duckduckgo.com/'); url.search = new URLSearchParams({ q: query, format: 'json' });
  return duckDuckGoResult(await json(options.fetchImpl, url, options));
}

function liveSearchSources(apiKeys = {}, searxngUrl = '') {
  return ['Wikipedia', 'Wikidata', 'SEC EDGAR', 'Federal Register', 'OpenAlex', 'Crossref', 'arXiv', 'PubMed', 'World Bank', ...(searxngUrl ? ['SearXNG'] : []), ...(apiKeys.fmp ? ['FMP'] : []), ...(apiKeys.finnhub ? ['Finnhub'] : []), ...(apiKeys.brave ? ['Brave'] : []), ...(apiKeys.tavily ? ['Tavily'] : []), 'DuckDuckGo Instant Answer'];
}
async function searchFacts(query, { fetchImpl = fetch, timeoutMs = 5000, apiKeys = {}, searxngUrl = '' } = {}) {
  const text = String(query || '').trim(); if (!text) return null;
  const options = { fetchImpl, timeoutMs, apiKeys, searxngUrl }, type = classify(text);
  const general = [wikipedia, searxngUrl && searxng, apiKeys.brave && brave, apiKeys.tavily && tavily, duckDuckGo].filter(Boolean);
  const financial = [apiKeys.fmp && fmpMetric, apiKeys.finnhub && finnhubMetric].filter(Boolean);
  const sources = type === 'filing' ? [edgar, wikipedia] : type === 'regulation' ? [federalRegister, wikipedia]
    : type === 'event' && apiKeys.fmp ? [fmpCalendar, wikipedia] : type === 'metric' ? (financial.length ? [...financial, wikipedia] : general) : general;
  const routed = type === 'research' ? [openAlex, crossref, arxiv] : type === 'medical' ? [pubmed, wikipedia]
    : type === 'country' ? [worldBank, wikipedia] : type === 'fact' ? [wikidata, wikipedia] : sources;
  for (const source of routed.slice(0, 2)) { const result = await source(text, options); if (result) return result; }
  return null;
}

module.exports = { searchFacts, liveSearchSources, getConfiguredSources: liveSearchSources, _internals: { classify, federalResult, tickerFrom, wikidataResult, openAlexResult, crossrefResult, arxivResult, pubmedResult, worldBankResult, duckDuckGoResult, searxngResult, resetTickerCache: () => { tickerCache = null; } } };
