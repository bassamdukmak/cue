const assert = require('node:assert/strict');
const test = require('node:test');
const { searchFacts } = require('../src/search');

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
