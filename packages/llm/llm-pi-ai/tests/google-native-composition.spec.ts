/** Native Gemini requests through the real Loader, SDK, tool loop, and serialized Session replay. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as LlmPiAi from '../src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

interface NativePart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { id: string; name: string; args: { text: string } }
  functionResponse?: { id: string; name: string; response: { output: string } }
}
interface NativeRequest {
  contents: { role: string; parts: NativePart[] }[]
  generationConfig?: { thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number } }
  tools?: { functionDeclarations: { name: string; parametersJsonSchema: object; parameters?: unknown }[] }[]
}

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await closeMockServers()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** SDK SSE frames contain Gemini candidates, never OpenAI choices or a DONE sentinel. */
function response(parts: NativePart[]): string[] {
  return [JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 } })]
}

/** Each invocation boots a fresh configured provider and credential store from Loader files. */
async function boot(
  baseURL: string, apiKeyEnv = 'NATIVE_TEST_KEY', catalog = false, api = 'google-generative-ai',
): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-google-native-'))
  roots.push(root)
  const credentialPath = join(root, 'credentials.yaml')
  await writeFile(credentialPath, 'version: 1\nrefs:\n  NATIVE_TEST_KEY: offline-native-key\n', { mode: 0o600 })
  const modules = new Map<string, unknown>([
    ['llm', LlmRuntime], ['credentials', LocalCredentialProvider], ['llm-pi-ai', LlmPiAi],
    ['session', SessionStore], ['session-projection', SessionProjectionRegistry], ['system-prompt', SystemPrompt],
    ['tools', ToolRuntime], ['agent', AgentRegistry], ['agent-loop', AgentLoop],
  ])
  const configPath = join(root, 'cordis.yml')
  const config: Record<string, object> = {
    credentials: { path: credentialPath, debounceMs: 10 },
    'system-prompt': { personaPrefix: '' },
    'llm-pi-ai': { providers: { [catalog ? 'google' : 'native-relay']: {
      ...catalog ? {} : { api, baseURL },
      apiKeyEnv, retryPolicy: { mode: 'normal', maxRetries: 0 },
      thinkingBudgets: { low: 1024 },
      models: [
        { id: 'gemini-3-flash-preview', reasoningEfforts: { low: 'low', high: 'high' } },
        { id: 'gemini-2.5-flash', reasoningEfforts: { low: 'low' } },
        { id: 'gemini-4-hydrogen', reasoningEfforts: { high: 'high' } },
      ],
    } } },
  }
  await writeFile(configPath, JSON.stringify([...modules.keys()].map(name => ({
    name, ...config[name] === undefined ? {} : { config: config[name] },
  }))))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const internal: ModuleLoaderV2 = {
    version: 'v2', loadCache: new Map(),
    import: async (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  await profileComposition(ctx, root, configPath)
  return { ctx, root }
}

it('replays native signed parallel calls and tool results after a fresh Loader boot', { timeout: 60_000 }, async () => {
  const signedParts: NativePart[] = [
    { thought: true, text: 'Plan', thoughtSignature: 'cGxhbg==' },
    { functionCall: { id: 'call-a', name: 'echo', args: { text: 'first' } }, thoughtSignature: 'Y2FsbC1h' },
    { functionCall: { id: 'call-b', name: 'echo', args: { text: 'second' } } },
  ]
  const signedText: NativePart = { text: 'Completed', thoughtSignature: 'Y29tcGxldGVk' }
  const server = await mockServer([
    { events: response(signedParts) }, { events: response([signedText]) }, { events: response([{ text: 'Continued' }]) },
    { events: response([{ text: 'Budget response' }]) },
  ])
  const { ctx, root } = await boot(`${server.url}/relay/v1beta`)
  const executed: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'echo', description: 'Echo text.', parameters: { text: { type: 'string', required: true } },
    async execute(args) { executed.push(args.text); return [{ type: 'text', text: args.text }] },
  }))
  const options = { provider: 'native-relay', model: 'gemini-3-flash-preview', reasoningEffort: ReasoningEffortId('low') }
  const agent = await ctx.agentLoop.create(SessionId('native-initial'), options)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Use echo twice' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(executed).toEqual(['first', 'second'])
  expect(server.requests).toHaveLength(2)
  const wire = server.requests as NativeRequest[]
  expect(wire[0]?.generationConfig?.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'LOW' })
  const declaration = wire[0]?.tools?.[0]?.functionDeclarations.find(tool => tool.name === 'echo')
  expect(declaration?.parametersJsonSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] })
  expect(declaration).not.toHaveProperty('parameters')
  expect(wire[1]?.contents.find(content => content.role === 'model')?.parts).toEqual(signedParts)
  const results = wire[1]?.contents.flatMap(content => content.parts).filter(part => part.functionResponse)
  expect(results).toEqual([
    { functionResponse: { id: 'call-a', name: 'echo', response: { output: 'first' } } },
    { functionResponse: { id: 'call-b', name: 'echo', response: { output: 'second' } } },
  ])
  expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(2)
  const seedPath = join(root, 'events.json')
  await writeFile(seedPath, JSON.stringify(agent.session.snapshotEvents()))
  const seed = JSON.parse(await readFile(seedPath, 'utf8')) as SessionEvent[]
  await ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(ctx), 1)
  const restarted = await boot(`${server.url}/relay/v1beta`)
  const restored = await restarted.ctx.agents.create({ sessionId: SessionId('native-restarted'), seed, agentOptions: options })
  try {
    restored.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue' }], source: { kind: 'user' } }))
    await restored.agent.whenIdle()
    expect(server.requests).toHaveLength(3)
    expect(wire[2]?.contents.filter(content => content.role === 'model').map(content => content.parts)).toEqual([signedParts, [signedText]])
    expect(wire[2]?.contents.filter(content => content.role === 'model' || content.parts.some(part => part.functionResponse))).toMatchSnapshot()
    expect(wire[2]?.contents.flatMap(content => content.parts).filter(part => part.functionResponse)).toEqual(results)
    expect(restored.agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'Continued' }])
    expect(executed).toEqual(['first', 'second'])
  } finally { await restored.dispose() }
  const budget = await assemble(restarted.ctx, {
    provider: 'native-relay', model: 'gemini-2.5-flash', reasoningEffort: ReasoningEffortId('low'),
    tools: [{ name: 'union', description: 'Accept text or a number.', parameters: {
      type: 'object', properties: { value: { type: ['string', 'number'] } }, required: ['value'],
    } }],
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Use a token budget' }], source: { kind: 'user' } })],
  })
  expect(budget.finish).toEqual({ kind: 'stop' })
  expect(wire[3]?.generationConfig?.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 1024 })
  expect(wire[3]?.tools?.[0]?.functionDeclarations[0]?.parametersJsonSchema).toMatchObject({
    properties: { value: { type: ['string', 'number'] } },
  })
  expect(server.paths).toEqual([
    ...Array.from({ length: 3 }, () => '/relay/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse'),
    '/relay/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
  ])
  for (const headers of server.headers) {
    expect(headers['x-goog-api-key']).toBe('offline-native-key')
    expect(headers['authorization']).toBeUndefined()
  }
})

it('sends discrete thinking levels to Gemini 4 models outside the installed catalog', async () => {
  const server = await mockServer([{ events: response([{ text: 'Gemini 4' }]) }])
  const { ctx } = await boot(`${server.url}/v1beta`)
  const result = await assemble(ctx, {
    provider: 'native-relay', model: 'gemini-4-hydrogen', reasoningEffort: ReasoningEffortId('high'),
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })],
  })
  expect(result.finish).toEqual({ kind: 'stop' })
  const wire = server.requests as NativeRequest[]
  expect(wire[0]?.generationConfig?.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'HIGH' })
})

it.each([
  ['adds /v1beta to an endpoint that names no API version', '/', '/v1beta'],
  ['keeps the API version an endpoint names', '/v1', '/v1'],
])('%s', async (_name, suffix, prefix) => {
  const server = await mockServer([{ events: response([{ text: 'Relay' }]) }])
  const { ctx } = await boot(`${server.url}${suffix}`)
  const result = await assemble(ctx, {
    provider: 'native-relay', model: 'gemini-3-flash-preview',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })],
  })
  expect(result.finish).toEqual({ kind: 'stop' })
  expect(server.paths).toEqual([`${prefix}/models/gemini-3-flash-preview:streamGenerateContent?alt=sse`])
})

/** One Vertex relay SSE frame carrying model parts. */
function vertexFrame(parts: object[], finishReason?: string, modelVersion = 'gemini-4-hydrogen-0611'): string {
  return JSON.stringify({
    candidates: [{ content: { role: 'model', parts }, ...finishReason === undefined ? {} : { finishReason } }],
    modelVersion,
    ...finishReason === undefined ? {} : { usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 } },
  })
}

it('streams Vertex relay tool arguments from partialArgs into the executed call', { timeout: 60_000 }, async () => {
  const server = await mockServer([
    { events: [
      vertexFrame([{ functionCall: { id: 'call-1', name: 'write', partialArgs: [
        { jsonPath: '$.path', stringValue: 'notes.md' },
        { jsonPath: '$.text', stringValue: 'Hello ', willContinue: true },
      ], willContinue: true }, thoughtSignature: 'c2ln' }]),
      vertexFrame([{ functionCall: { partialArgs: [
        { jsonPath: '$.text', stringValue: 'world', willContinue: true },
      ], willContinue: true } }]),
      vertexFrame([{ functionCall: { partialArgs: [
        { jsonPath: '$.text', stringValue: '!' },
        { jsonPath: '$.lines[0]', numberValue: 3 },
        { jsonPath: '$.lines[1]', numberValue: 4 },
        { jsonPath: '$.force', boolValue: true },
      ] } }], 'STOP'),
    ] },
    { events: [vertexFrame([{ text: 'Done' }], 'STOP')] },
  ])
  const { ctx } = await boot(server.url, 'NATIVE_TEST_KEY', false, 'google-vertex')
  const executed: unknown[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'write', description: 'Write text.',
    parameters: {
      path: { type: 'string', required: true }, text: { type: 'string', required: true },
      lines: { type: 'array', items: { type: 'number' }, required: true }, force: { type: 'boolean', required: true },
    },
    async execute(args) { executed.push(args); return [{ type: 'text', text: 'written' }] },
  }))
  const agent = await ctx.agentLoop.create(SessionId('vertex-relay'), { provider: 'native-relay', model: 'gemini-4-hydrogen' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write the note' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(executed).toEqual([{ path: 'notes.md', text: 'Hello world!', lines: [3, 4], force: true }])
  expect(server.paths).toEqual(Array.from({ length: 2 }, () => '/v1beta/models/gemini-4-hydrogen:streamGenerateContent?alt=sse'))
  const wire = server.requests as (NativeRequest & {
    toolConfig?: { functionCallingConfig?: { streamFunctionCallArguments?: boolean } }
  })[]
  expect(wire[0]?.toolConfig?.functionCallingConfig?.streamFunctionCallArguments).toBe(true)
  expect(wire[1]?.contents.find(content => content.role === 'model')?.parts).toEqual([{
    functionCall: { id: 'call-1', name: 'write', args: { path: 'notes.md', text: 'Hello world!', lines: [3, 4], force: true } },
    thoughtSignature: 'c2ln',
  }])
  for (const headers of server.headers) {
    expect(headers['x-goog-api-key']).toBe('offline-native-key')
    expect(headers['authorization']).toBeUndefined()
  }
})

it('emits Vertex relay partialArgs as incremental JSON argument text', async () => {
  const server = await mockServer([{ events: [
    vertexFrame([{ functionCall: { name: 'write', partialArgs: [
      { jsonPath: '$.text', stringValue: 'He"llo', willContinue: true },
    ], willContinue: true } }]),
    vertexFrame([{ functionCall: { partialArgs: [
      { jsonPath: '$.text', stringValue: ' world' },
      { jsonPath: "$.opts['a b'].n", numberValue: 1 },
    ] } }], 'STOP'),
  ] }])
  const { ctx } = await boot(`${server.url}/v1beta`, 'NATIVE_TEST_KEY', false, 'google-vertex')
  const deltas: string[] = []
  for await (const chunk of ctx.llm.stream({
    provider: 'native-relay', model: 'gemini-4-hydrogen',
    tools: [{ name: 'write', description: 'Write.', parameters: { type: 'object', properties: {} } }],
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Write' }], source: { kind: 'user' } })],
  })) {
    if (chunk.type === 'tool-call-delta') deltas.push(chunk.argumentsDelta)
  }
  expect(deltas.length).toBeGreaterThan(1)
  expect(JSON.parse(deltas.join(''))).toEqual({ text: 'He"llo world', opts: { 'a b': { n: 1 } } })
})

it('fails a Vertex relay stream that ends inside a function call', async () => {
  const server = await mockServer([{ events: [
    vertexFrame([{ functionCall: { name: 'write', partialArgs: [{ jsonPath: '$.text', stringValue: 'Hel', willContinue: true }],
      willContinue: true } }], 'STOP'),
  ] }])
  const { ctx } = await boot(`${server.url}/v1beta`, 'NATIVE_TEST_KEY', false, 'google-vertex')
  const result = await assemble(ctx, {
    provider: 'native-relay', model: 'gemini-4-hydrogen',
    tools: [{ name: 'write', description: 'Write.', parameters: { type: 'object', properties: {} } }],
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Write' }], source: { kind: 'user' } })],
  })
  expect(result.finish).toMatchObject({ kind: 'error' })
})

it('stops a Vertex relay response served by a different model', async () => {
  const server = await mockServer([{ events: [vertexFrame([{ text: 'substitute' }], 'STOP', '3.1-flash-lite-05-2026')] }])
  const { ctx } = await boot(`${server.url}/v1beta`, 'NATIVE_TEST_KEY', false, 'google-vertex')
  const result = await assemble(ctx, { provider: 'native-relay', model: 'gemini-4-hydrogen', messages: [
    createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }),
  ] })
  expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'MODEL_MISMATCH' } })
  expect(result.message.content).toEqual([])
})

it('refuses a Vertex relay route without an API key before any request', async () => {
  const server = await mockServer([])
  const { ctx } = await boot(`${server.url}/v1beta`, '', false, 'google-vertex')
  const result = await assemble(ctx, { provider: 'native-relay', model: 'gemini-4-hydrogen', messages: [] })
  expect(result.finish).toMatchObject({ kind: 'error' })
  expect(server.requests).toEqual([])
})

it('keeps the official Google catalog endpoint when no endpoint override is configured', async () => {
  const server = await mockServer([{ events: response([{ text: 'Official endpoint' }]) }])
  const expectedURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse'
  const originalFetch = globalThis.fetch
  // The Google adapter forbids injected fetch. Intercept only this test's exact official URL.
  const redirect = vi.fn<typeof fetch>(async (input, init) => {
    const requestedURL = input instanceof Request ? input.url : String(input)
    if (requestedURL !== expectedURL) throw new Error(`unexpected native endpoint: ${requestedURL}`)
    const url = new URL(requestedURL)
    return originalFetch(`${server.url}${url.pathname}${url.search}`, init)
  })
  vi.stubGlobal('fetch', redirect)
  try {
    const { ctx } = await boot('', 'NATIVE_TEST_KEY', true)
    const result = await assemble(ctx, {
      provider: 'google', model: 'gemini-3-flash-preview',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })],
    })
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(redirect).toHaveBeenCalledOnce()
    expect(server.paths).toEqual(['/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse'])
    expect(server.headers[0]?.['x-goog-api-key']).toBe('offline-native-key')
  } finally { vi.unstubAllGlobals() }
})

it('fails a missing named credential before any native request', async () => {
  const server = await mockServer([])
  const { ctx } = await boot(`${server.url}/v1beta`, 'NATIVE_MISSING_KEY')
  const result = await assemble(ctx, { provider: 'native-relay', model: 'gemini-3-flash-preview', messages: [] })
  expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
  expect(server.requests).toEqual([])
})

it('stops a response served by a different model before any output is forwarded', async () => {
  const frame = (modelVersion: string): string[] => [JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text: 'substitute answer' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 }, modelVersion,
  })]
  const server = await mockServer([{ events: frame('3.1-flash-lite-05-2026') }, { events: frame('gemini-4-hydrogen-0611') }])
  const { ctx } = await boot(`${server.url}/v1beta`)
  const request = { provider: 'native-relay', model: 'gemini-4-hydrogen', messages: [
    createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }),
  ] }
  const substituted = await assemble(ctx, request)
  expect(substituted.finish).toMatchObject({ kind: 'error', failure: { code: 'MODEL_MISMATCH' } })
  expect(substituted.finish.kind === 'error' && substituted.finish.failure.message).toContain('3.1-flash-lite-05-2026')
  expect(substituted.message.content).toEqual([])
  const served = await assemble(ctx, request)
  expect(served.finish).toEqual({ kind: 'stop' })
})
