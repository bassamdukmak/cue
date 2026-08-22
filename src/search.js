const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

async function searchFacts(query, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const text = String(query || '').trim();
  if (!text) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const searchUrl = new URL(WIKIPEDIA_API);
    searchUrl.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: text, format: 'json', origin: '*' });
    const search = await fetchImpl(searchUrl, { signal: controller.signal });
    if (!search.ok) return null;
    const title = (await search.json())?.query?.search?.[0]?.title;
    if (!title) return null;

    const summary = await fetchImpl(WIKIPEDIA_SUMMARY + encodeURIComponent(title.replace(/ /g, '_')), { signal: controller.signal });
    if (!summary.ok) return null;
    const page = await summary.json();
    if (!page?.extract) return null;
    return {
      summary: page.extract,
      source: 'Wikipedia',
      url: page.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { searchFacts };
