import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime, { WebError } from '@deepseek-ai/dsh-web'
import {
  EXA_DEFAULT_BASE_URL, EXA_DEFAULT_HIGHLIGHTS_PER_RESULT, EXA_DEFAULT_SEARCH_TYPE, EXA_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-exa'
import * as host from '../lib/index.js'

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}
function mount(resolve, config = host.Config({})) {
  let provider
  host.apply({ credentials: { resolve }, web: { registerSearchProvider(value) {
    assert.equal(provider, undefined)
    provider = value
  } } }, config)
  assert.equal(provider.id, EXA_PROVIDER_ID)
  return provider
}
function hasCode(code) {
  return error => { assert.ok(error instanceof WebError); assert.equal(error.code, code); return true }
}

test('config persists references and endpoint, never a literal secret', () => {
  assert.deepEqual(Object.keys(host.Config.dict).sort(), ['apiKeyEnv', 'baseURL'])
  assert.equal(host.Config.dict.apiKeyEnv.meta.role, 'credential-ref')
  const config = host.Config({})
  assert.equal(config.apiKeyEnv.get(), host.DEFAULT_API_KEY_REF)
  assert.equal(config.baseURL.get(), EXA_DEFAULT_BASE_URL)
})

test('key rotation takes effect without remounting', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => jsonResponse({ results: [] }))
  let key = 'test-key-before-rotation'
  const references = []
  const provider = mount(async ref => { references.push(ref); return { value: key, source: 'test' } })
  assert.equal(provider.available(), true)
  assert.deepEqual(references, [])
  await provider.search({ query: 'first' })
  key = 'test-key-after-rotation'
  await provider.search({ query: 'second' })
  assert.deepEqual(references, [host.DEFAULT_API_KEY_REF, host.DEFAULT_API_KEY_REF])
  assert.deepEqual(fetchMock.mock.calls.map(({ arguments: [, init] }) => new Headers(init.headers).get('authorization')),
    ['Bearer test-key-before-rotation', 'Bearer test-key-after-rotation'])
})

test('missing keys fail without network; a saved key immediately enables search', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => jsonResponse({ results: [] }))
  let credential
  const provider = mount(async () => credential)
  await assert.rejects(provider.search({ query: 'missing' }), hasCode('WEB_PROVIDER_UNAVAILABLE'))
  credential = { value: '', source: 'test' }
  await assert.rejects(provider.search({ query: 'empty' }), hasCode('WEB_PROVIDER_UNAVAILABLE'))
  assert.equal(fetchMock.mock.callCount(), 0)
  credential = { value: 'test-key-saved-later', source: 'test' }
  await provider.search({ query: 'configured' })
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('official transport receives query, bound and signal and maps original sources', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => jsonResponse({ results: [
    { url: 'https://first.test/article', title: 'First', highlights: [' ', 'original highlight'], publishedDate: '2026-01-02' },
    { url: 'https://empty.test/article' },
  ] }))
  const provider = mount(async () => ({ value: 'test-exa-key', source: 'test' }))
  const request = Object.freeze({ query: ' original query 中文 ', maxResults: 7 })
  const signal = new AbortController().signal
  const result = await provider.search(request, signal)
  const [url, init] = fetchMock.mock.calls[0].arguments
  assert.equal(url, `${EXA_DEFAULT_BASE_URL}/search`)
  assert.equal(init.method, 'POST')
  assert.equal(init.redirect, 'error')
  assert.equal(init.signal, signal)
  assert.deepEqual(JSON.parse(init.body), {
    query: request.query, type: EXA_DEFAULT_SEARCH_TYPE,
    contents: { highlights: { highlightsPerUrl: EXA_DEFAULT_HIGHLIGHTS_PER_RESULT } }, numResults: 7,
  })
  assert.deepEqual(result, { sources: [{ url: 'https://first.test/article', title: 'First', snippet: 'original highlight', publishedAt: '2026-01-02' }], truncated: false })
})

test('volatile reference and endpoint are reread while omitted limits stay omitted', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => jsonResponse({ results: [] }))
  let ref = 'EXA_FIRST_KEY'
  let baseURL = 'https://first-exa.test'
  const refs = []
  const provider = mount(async value => { refs.push(value); return { value: 'test-key', source: 'test' } }, {
    apiKeyEnv: { get: () => ref }, baseURL: { get: () => baseURL },
  })
  await provider.search({ query: 'first' })
  ref = 'EXA_SECOND_KEY'; baseURL = 'https://second-exa.test'
  await provider.search({ query: 'second' })
  assert.deepEqual(refs, ['EXA_FIRST_KEY', 'EXA_SECOND_KEY'])
  assert.deepEqual(fetchMock.mock.calls.map(({ arguments: [url] }) => url), ['https://first-exa.test/search', 'https://second-exa.test/search'])
  for (const { arguments: [, init] } of fetchMock.mock.calls) assert.equal(Object.hasOwn(JSON.parse(init.body), 'numResults'), false)
})

test('credential failures propagate without fallback', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => jsonResponse({ results: [] }))
  const failure = new Error('test credential store failure')
  const provider = mount(async () => { throw failure })
  await assert.rejects(provider.search({ query: 'query' }), error => error === failure)
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('official abort classification is preserved', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('test cancellation', 'AbortError') })
  const provider = mount(async () => ({ value: 'test-key', source: 'test' }))
  await assert.rejects(provider.search({ query: 'query' }, new AbortController().signal), hasCode('WEB_ABORTED'))
})

test('real Cordis disposal removes EXA and a remount restores it', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => jsonResponse({ results: [] }))
  const ctx = new Context()
  try {
    ctx.provide('credentials', { resolve: async () => ({ value: 'test-key', source: 'test' }) })
    await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
    const fiber = await ctx.plugin(host, {})
    await ctx.web.search({ query: 'mounted' })
    await fiber.dispose()
    await assert.rejects(ctx.web.search({ query: 'disposed' }), hasCode('WEB_PROVIDER_CONFIGURED_MISSING'))
    assert.equal(fetchMock.mock.callCount(), 1)
    await ctx.plugin(host, {})
    await ctx.web.search({ query: 'remounted' })
    assert.equal(fetchMock.mock.callCount(), 2)
  } finally { await ctx.fiber.dispose() }
})
