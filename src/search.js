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
const GDELT_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const REST_COUNTRIES = 'https://restcountries.com/v3.1/name/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const COINGECKO_PRICE = 'https://api.coingecko.com/api/v3/simple/price';
const FRANKFURTER = 'https://api.frankfurter.app/';
const USGS_EARTHQUAKES = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const OPEN_LIBRARY = 'https://openlibrary.org/search.json';
const WAYBACK = 'https://archive.org/wayback/available';
const HN_ALGOLIA = 'https://hn.algolia.com/api/v1/search';
let tickerCache = null;

function classify(query) {
  if (/\b(8-k|10-[qk]|20-f|40-f|sec filing|filed|filing|annual report|quarterly report)\b/i.test(query)) return 'filing';
  if (/\b(regulation|regulatory|rulemaking|final rule|proposed rule|federal register|agency action|effective date)\b/i.test(query)) return 'regulation';
  if (/\b(their site (?:used to )?said|site used to say|historical page|archived page|wayback|web archive)\b/i.test(query)) return 'wayback';
  if (/\b(earthquake|seismic|tremor)\b/i.test(query)) return 'earthquake';
  if (/\b(weather|temperature|rainfall|precipitation|climate|forecast)\b/i.test(query)) return 'weather';
  if (/\b(bitcoin|ethereum|crypto(?:currency)?|\bbtc\b|\beth\b)\b/i.test(query) && /\b(price|market cap|worth|value)\b/i.test(query)) return 'crypto';
  if (/\b(exchange rate|currency conversion|convert|foreign exchange|\bfx\b)\b/i.test(query)) return 'exchange';
  if (/\b(book|author|isbn|novel|published by)\b/i.test(query)) return 'book';
  if (/\b(hacker news|\bhn\b|tech industry|tech launch|product launch|startup launch)\b/i.test(query)) return 'tech';
  if (/\b(recent news|latest news|did .+ happen|what happened)\b/i.test(query)) return 'news';
  if (/\b(place|distance|where is|where are|does .+ exist|location|located)\b/i.test(query)) return 'place';
  if (/\b(next week|next month|tomorrow|monday|tuesday|wednesday|thursday|friday|reports? (?:on|next|this)|earnings|cpi|fomc|fed meets?|economic (?:release|event))\b/i.test(query)) return 'event';
  if (/\b(revenue|earnings per share|eps|market cap|stock price|financial metric|margin|guidance|company profile|cash flow|balance sheet|income statement|news|headlines)\b/i.test(query)
    || /^(?:\$)?[A-Z]{1,5}$/.test(String(query).trim())) return 'metric';
  if (/\b(doctor|medical|medicine|health|disease|patient|clinical|drug|treatment|therapy|diagnosis|vaccine|cancer)\b/i.test(query)) return 'medical';
  if (/\b(study|studies|research|paper|journal|citation|citations|doi|published)\b/i.test(query)) return 'research';
  if (countryCode(query) && /\b(capital|currency|area|border|borders|population)\b/i.test(query)) return 'countryFact';
  if (countryCode(query) && /\b(gdp|gross domestic product|unemployment|inflation|economic growth|gdp growth)\b/i.test(query)) return 'country';
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

function countryName(query) {
  const text = String(query || '').toLowerCase();
  const countries = { argentina: 'Argentina', australia: 'Australia', brazil: 'Brazil', canada: 'Canada', china: 'China', france: 'France', germany: 'Germany', india: 'India', indonesia: 'Indonesia', italy: 'Italy', japan: 'Japan', mexico: 'Mexico', nigeria: 'Nigeria', pakistan: 'Pakistan', russia: 'Russia', 'south africa': 'South Africa', 'south korea': 'South Korea', spain: 'Spain', turkey: 'Turkey', uk: 'United Kingdom', 'united kingdom': 'United Kingdom', 'united states': 'United States', usa: 'United States' };
  return Object.entries(countries).find(([name]) => new RegExp('\\b' + name + '\\b', 'i').test(text))?.[1] || null;
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

function gdeltResult(article) {
  if (!article?.title || !article?.url) return null;
  return { summary: article.title + (article.seendate ? ' (' + article.seendate + ')' : '') + '.', source: 'GDELT', url: article.url };
}
async function gdelt(query, options) {
  const url = new URL(GDELT_API); url.search = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '1' });
  return gdeltResult((await json(options.fetchImpl, url, options))?.articles?.[0]);
}

function openMeteoResult(data, place) {
  const current = data?.current;
  const hourly = data?.hourly;
  const temperature = current?.temperature_2m ?? hourly?.temperature_2m?.[0];
  if (temperature == null) return null;
  const weather = [`${place || 'Location'}: ${temperature}°C`, (current?.precipitation ?? hourly?.precipitation?.[0]) != null && `precipitation ${current?.precipitation ?? hourly?.precipitation?.[0]} mm`, (current?.wind_speed_10m ?? hourly?.wind_speed_10m?.[0]) != null && `wind ${current?.wind_speed_10m ?? hourly?.wind_speed_10m?.[0]} km/h`].filter(Boolean).join(', ');
  return { summary: weather + '.', source: 'Open-Meteo', url: data?.latitude != null && data?.longitude != null ? `https://open-meteo.com/en/docs#latitude=${data.latitude}&longitude=${data.longitude}` : 'https://open-meteo.com/' };
}
async function openMeteo(query, options) {
  const place = /\b(?:in|at|for)\s+([\p{L} .'-]+?)(?:[?.,]|$)/iu.exec(query)?.[1]?.trim() || countryName(query);
  if (!place) return null;
  const geocode = new URL(OPEN_METEO_GEOCODING); geocode.search = new URLSearchParams({ name: place, count: '1' });
  const location = (await json(options.fetchImpl, geocode, options))?.results?.[0];
  if (location?.latitude == null || location.longitude == null) return null;
  const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(query)?.[1];
  const archive = Boolean(date);
  const url = new URL(archive ? OPEN_METEO_ARCHIVE : OPEN_METEO_FORECAST);
  url.search = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude, ...(archive ? { hourly: 'temperature_2m,precipitation,wind_speed_10m', start_date: date || '2020-01-01', end_date: date || '2020-01-01' } : { current: 'temperature_2m,precipitation,wind_speed_10m' }) });
  return openMeteoResult(await json(options.fetchImpl, url, options), location.name);
}

function restCountriesResult(country) {
  if (!country?.name?.common) return null;
  const currencies = Object.values(country.currencies || {}).map((item) => item?.name || item?.symbol).filter(Boolean).join(', ');
  const details = [country.capital?.[0] && 'capital ' + country.capital[0], currencies && 'currency ' + currencies, country.population != null && 'population ' + country.population.toLocaleString(), country.area != null && 'area ' + country.area + ' km²', country.borders?.length && 'borders ' + country.borders.join(', ')].filter(Boolean);
  return details.length ? { summary: country.name.common + ': ' + details.join('; ') + '.', source: 'REST Countries', url: 'https://restcountries.com/v3.1/name/' + encodeURIComponent(country.name.common) } : null;
}
async function restCountries(query, options) {
  const name = countryName(query); if (!name) return null;
  return restCountriesResult((await json(options.fetchImpl, REST_COUNTRIES + encodeURIComponent(name), options))?.[0]);
}

function nominatimResult(place) {
  if (!place?.display_name || place.lat == null || place.lon == null) return null;
  return { summary: place.display_name + ` (${place.lat}, ${place.lon}).`, source: 'OpenStreetMap Nominatim', url: 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(place.lat) + '&mlon=' + encodeURIComponent(place.lon) };
}
function nominatimDistanceResult(a, b) {
  if (a?.lat == null || a?.lon == null || b?.lat == null || b?.lon == null) return null;
  const radians = Math.PI / 180, lat1 = Number(a.lat) * radians, lat2 = Number(b.lat) * radians, dLat = lat2 - lat1, dLon = (Number(b.lon) - Number(a.lon)) * radians;
  const km = 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2));
  return Number.isFinite(km) ? { summary: `${a.display_name} to ${b.display_name}: about ${Math.round(km)} km apart.`, source: 'OpenStreetMap Nominatim', url: 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(a.lat) + '&mlon=' + encodeURIComponent(a.lon) } : null;
}
async function nominatim(query, options) {
  const headers = { 'User-Agent': 'cue-meeting-assistant (contact: user)', Accept: 'application/json' };
  const lookup = async (term) => { const url = new URL(NOMINATIM); url.search = new URLSearchParams({ q: term, format: 'json', limit: '1' }); return (await json(options.fetchImpl, url, { ...options, headers }))?.[0]; };
  const pair = /\bdistance (?:between )?(.+?)\s+and\s+(.+?)(?:\?|$)/i.exec(query);
  if (pair) return nominatimDistanceResult(await lookup(pair[1]), await lookup(pair[2]));
  const term = /\b(?:where is|where are|does|place|location|located|distance to)\s+(.+?)(?:\?|$)/i.exec(query)?.[1] || query;
  return nominatimResult(await lookup(term));
}

function cryptoId(query) { return /\b(bitcoin|btc)\b/i.test(query) ? 'bitcoin' : /\b(ethereum|eth)\b/i.test(query) ? 'ethereum' : null; }
function coinGeckoResult(body, id) {
  const row = body?.[id]; if (!row || row.usd == null) return null;
  return { summary: `${id}: $${row.usd}${row.usd_market_cap != null ? `; market cap $${row.usd_market_cap}` : ''}.`, source: 'CoinGecko', url: 'https://www.coingecko.com/en/coins/' + id };
}
async function coinGecko(query, options) {
  const id = cryptoId(query); if (!id) return null;
  const url = new URL(COINGECKO_PRICE); url.search = new URLSearchParams({ ids: id, vs_currencies: 'usd', include_market_cap: 'true' });
  return coinGeckoResult(await json(options.fetchImpl, url, options), id);
}

function currencyCodes(query) {
  const names = { dollar: 'USD', usd: 'USD', euro: 'EUR', eur: 'EUR', pound: 'GBP', gbp: 'GBP', yen: 'JPY', jpy: 'JPY', cad: 'CAD', canadian: 'CAD' };
  return [...String(query).matchAll(/\b[A-Z]{3}\b/g)].map((match) => match[0]).concat(Object.entries(names).filter(([name]) => new RegExp('\\b' + name + '\\b', 'i').test(query)).map(([, code]) => code)).filter((code, index, list) => list.indexOf(code) === index);
}
function frankfurterResult(body, from, to) {
  const rate = body?.rates?.[to];
  return rate == null ? null : { summary: `1 ${from} = ${rate} ${to}${body.date ? ` (${body.date})` : ''}.`, source: 'Frankfurter', url: 'https://www.frankfurter.app/' };
}
async function frankfurter(query, options) {
  const [from = 'EUR', to = from === 'USD' ? 'EUR' : 'USD'] = currencyCodes(query);
  const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(query)?.[0] || 'latest';
  const url = new URL(FRANKFURTER + date); url.search = new URLSearchParams({ from, to });
  return frankfurterResult(await json(options.fetchImpl, url, options), from, to);
}

function usgsResult(feature) {
  if (!feature?.properties?.title) return null;
  return { summary: feature.properties.title + (feature.properties.time ? ' (' + new Date(feature.properties.time).toISOString() + ')' : '') + '.', source: 'USGS Earthquake', url: feature.properties.url || null };
}
async function usgs(query, options) {
  const url = new URL(USGS_EARTHQUAKES); url.search = new URLSearchParams({ format: 'geojson', limit: '1', orderby: 'time' });
  const magnitude = /\b(?:magnitude|mag)\s*(\d+(?:\.\d+)?)/i.exec(query)?.[1]; if (magnitude) url.searchParams.set('minmagnitude', magnitude);
  return usgsResult((await json(options.fetchImpl, url, options))?.features?.[0]);
}

function openLibraryResult(book) {
  if (!book?.title) return null;
  const author = book.author_name?.[0], year = book.first_publish_year, isbn = book.isbn?.[0];
  const details = [author && 'by ' + author, year && String(year), isbn && 'ISBN ' + isbn].filter(Boolean).join(' — ');
  return { summary: book.title + (details ? ' — ' + details : '') + '.', source: 'Open Library', url: book.key ? 'https://openlibrary.org' + book.key : 'https://openlibrary.org/search?q=' + encodeURIComponent(book.title) };
}
async function openLibrary(query, options) {
  const url = new URL(OPEN_LIBRARY); url.search = new URLSearchParams({ q: query, limit: '1' });
  return openLibraryResult((await json(options.fetchImpl, url, options))?.docs?.[0]);
}

function waybackResult(body) {
  const snapshot = body?.archived_snapshots?.closest;
  if (!snapshot?.available || !snapshot.url) return null;
  return { summary: `Archived snapshot available${snapshot.timestamp ? ' from ' + snapshot.timestamp : ''}.`, source: 'Wayback Machine', url: snapshot.url };
}
async function wayback(query, options) {
  const urlMatch = /https?:\/\/[^\s"']+/.exec(query); if (!urlMatch) return null;
  const url = new URL(WAYBACK); url.search = new URLSearchParams({ url: urlMatch[0] });
  const timestamp = /\b(\d{8}|\d{4}-\d{2}-\d{2})\b/.exec(query)?.[1]; if (timestamp) url.searchParams.set('timestamp', timestamp.replace(/-/g, ''));
  return waybackResult(await json(options.fetchImpl, url, options));
}

function hackerNewsResult(hit) {
  if (!hit?.title && !hit?.story_title) return null;
  const title = hit.title || hit.story_title, url = hit.url || hit.story_url || (hit.objectID && 'https://news.ycombinator.com/item?id=' + hit.objectID);
  return { summary: title + (hit.points != null ? ` (${hit.points} points)` : '') + '.', source: 'Hacker News', url: url || null };
}
async function hackerNews(query, options) {
  const url = new URL(HN_ALGOLIA); url.search = new URLSearchParams({ query, hitsPerPage: '1' });
  return hackerNewsResult((await json(options.fetchImpl, url, options))?.hits?.[0]);
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
  return ['Wikipedia', 'Wikidata', 'SEC EDGAR', 'Federal Register', 'OpenAlex', 'Crossref', 'arXiv', 'PubMed', 'World Bank', 'GDELT', 'Open-Meteo', 'REST Countries', 'OpenStreetMap Nominatim', 'CoinGecko', 'Frankfurter', 'USGS Earthquake', 'Open Library', 'Wayback Machine', 'Hacker News', ...(searxngUrl ? ['SearXNG'] : []), ...(apiKeys.fmp ? ['FMP'] : []), ...(apiKeys.finnhub ? ['Finnhub'] : []), ...(apiKeys.brave ? ['Brave'] : []), ...(apiKeys.tavily ? ['Tavily'] : []), 'DuckDuckGo Instant Answer'];
}
async function searchFacts(query, { fetchImpl = fetch, timeoutMs = 5000, apiKeys = {}, searxngUrl = '' } = {}) {
  const text = String(query || '').trim(); if (!text) return null;
  const options = { fetchImpl, timeoutMs, apiKeys, searxngUrl }, type = classify(text);
  const general = [wikipedia, searxngUrl && searxng, apiKeys.brave && brave, apiKeys.tavily && tavily, duckDuckGo].filter(Boolean);
  const financial = [apiKeys.fmp && fmpMetric, apiKeys.finnhub && finnhubMetric].filter(Boolean);
  const sources = type === 'filing' ? [edgar, wikipedia] : type === 'regulation' ? [federalRegister, wikipedia]
    : type === 'news' ? [gdelt, wikipedia] : type === 'weather' ? [openMeteo] : type === 'place' ? [nominatim]
    : type === 'crypto' ? [coinGecko] : type === 'exchange' ? [frankfurter] : type === 'earthquake' ? [usgs]
    : type === 'book' ? [openLibrary] : type === 'wayback' ? [wayback] : type === 'tech' ? [hackerNews, wikipedia]
    : type === 'event' && apiKeys.fmp ? [fmpCalendar, wikipedia] : type === 'metric' ? (financial.length ? [...financial, wikipedia] : general) : general;
  const routed = type === 'research' ? [openAlex, crossref, arxiv] : type === 'medical' ? [pubmed, wikipedia]
    : type === 'countryFact' ? [restCountries, worldBank] : type === 'country' ? [worldBank, wikipedia] : type === 'fact' ? [wikidata, wikipedia] : sources;
  for (const source of routed.slice(0, 2)) { const result = await source(text, options); if (result) return result; }
  return null;
}

module.exports = { searchFacts, liveSearchSources, getConfiguredSources: liveSearchSources, _internals: { classify, federalResult, tickerFrom, wikidataResult, openAlexResult, crossrefResult, arxivResult, pubmedResult, worldBankResult, gdeltResult, openMeteoResult, restCountriesResult, nominatimResult, nominatimDistanceResult, coinGeckoResult, frankfurterResult, usgsResult, openLibraryResult, waybackResult, hackerNewsResult, duckDuckGoResult, searxngResult, resetTickerCache: () => { tickerCache = null; } } };
