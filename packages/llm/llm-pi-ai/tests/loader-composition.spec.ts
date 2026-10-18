/** Profile patch edits and credential updates reach the next real adapter request. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createMessage, createUserMessage, userAgent } from '@deepseek-ai/dsh-llm'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, taggedEvents, textEvents } from './mock-server.ts'

/** One text block, then a tool call truncated by the output-token ceiling. */
const truncatedToolCallEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"partial"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"echo","arguments":"{\\"text\\":"}}]},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
  '[DONE]',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** Boot the dormant composition: a bare `llm-pi-ai` row with no config at all. */
async function loadComposition(withLoop = false): Promise<{ ctx: Context; settingsPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-pi-composition-'))
  await writeFile(join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  PI_COMPOSITION_KEY: key-from-store\n', { mode: 0o600 })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    '- id: authorization',
    "  name: '@deepseek-ai/dsh-authorization'",
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    ...withLoop ? [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      '  config:',
      "    personaPrefix: ''",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-llm-retry'",
      "- name: '@deepseek-ai/dsh-agent-loop'",
    ] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-authorization', AuthorizationService],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-llm-retry', LlmRetry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  const patchPath = await profileComposition(ctx, root, configPath)
  return { ctx, settingsPath: patchPath }
}

describe('llm-pi-ai real dormant composition', () => {
  it('runs text tool calls through policy and transient retries, retaining the request format in Session history', { timeout: 60_000 }, async () => {
    const calls = ['allowed', 'denied', 'tool-error'].map(text => `<tool_call>${JSON.stringify({ name: 'echo', arguments: { text } })}</tool_call>`).join('\n')
    const server = await mockServer([
      { status: 503, body: '{"error":{"message":"temporary outage"}}' },
      { events: taggedEvents(calls) },
      { events: textEvents },
      { events: textEvents },
      { events: taggedEvents('Discard this failed attempt\n<tool_call>{') },
      { events: textEvents },
    ])
    const { ctx, settingsPath } = await loadComposition(true)
    await writeFile(settingsPath, [
      '- id: llm-pi-ai', '  config:', '    providers:', '      gateway:',
      '        apiKeyEnv: PI_COMPOSITION_KEY', '        api: openai-completions',
      `        baseURL: ${server.url}`, '        retryPolicy:', '          mode: normal',
      '          maxRetries: 1', '          backoff:', '            initialDelayMs: 1',
      '            maxDelayMs: 1', '            jitterRatio: 0', '        models:',
      '          - id: m', '            toolMode: tagged-json', '',
    ].join('\n'))
    await vi.waitFor(() => { expect(ctx.llm.listProviders().map(row => row.id)).toEqual(['gateway']) }, { timeout: 5000 })
    const executed: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'Return text.', parameters: { text: { type: 'string', required: true } },
      async execute(args) {
        executed.push(args.text)
        if (args.text === 'tool-error') throw new Error('scripted tool failure')
        return [{ type: 'text', text: args.text }]
      },
    }))
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if ((exec.arguments as { text: string }).text === 'denied') return { kind: 'deny', reason: 'not authorized' }
      return next()
    })
    const agent = await ctx.agentLoop.create(SessionId('text-tools'), { provider: 'gateway', model: 'm' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Use echo' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(executed).toEqual(['allowed', 'tool-error'])
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool/call')).toHaveLength(3)
    expect(events.filter(event => event.type === 'tool/result').map(event => event.data.message.isError ?? false)).toEqual([false, true, true])
    expect(agent.session.requestHeader()?.config.requestFormat).toMatchObject({ id: 'tagged-json', version: 1 })
    expect(agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'hello' }])
    const wire = server.requests[2] as { tools?: unknown; messages: { role: string; content: unknown; tool_calls?: unknown }[] }
    expect(wire.tools).toBeUndefined()
    expect(wire.messages.every(message => message.role !== 'tool' && message.tool_calls === undefined)).toBe(true)
    // Pin the actual provider input rather than source-code string fragments.
    expect((server.requests[1] as { messages: unknown[] }).messages[0]).toMatchSnapshot()
    const seed = JSON.parse(JSON.stringify(events)) as typeof events
    const restored = await ctx.agents.create({
      sessionId: SessionId('restored-text-tools'), seed,
      agentOptions: { provider: 'gateway', model: 'm' },
    })
    try {
      expect(restored.agent.session.requestHeader()?.config.requestFormat).toEqual(agent.session.requestHeader()?.config.requestFormat)
      restored.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue without more calls' }], source: { kind: 'user' } }))
      await restored.agent.whenIdle()
      expect(executed).toEqual(['allowed', 'tool-error'])
      expect(server.requests).toHaveLength(4)
      expect((server.requests[3] as { messages: unknown[] }).messages).toEqual([
        ...wire.messages,
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'Continue without more calls' },
      ])
      restored.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Malformed response' }], source: { kind: 'user' } }))
      await restored.agent.whenIdle()
      expect(server.requests).toHaveLength(5)
      expect(restored.agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(2)
      expect(restored.agent.session.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(3)
      restored.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Try again' }], source: { kind: 'user' } }))
      await restored.agent.whenIdle()
      expect(server.requests).toHaveLength(6)
      expect(executed).toEqual(['allowed', 'tool-error'])
      expect(JSON.stringify(server.requests[5])).not.toContain('Discard this failed attempt')
      expect(restored.agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'hello' }])
    } finally {
      await restored.dispose()
    }
  })

  it('boots with zero routes and registers one the moment settings supply a profile', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()

    // The shipped posture: the adapter exists, no route does.
    expect(ctx.llm.listProviders()).toEqual([])
    const directory = ctx.llm.listConfigurableProviders()
    expect(directory.find(entry => entry.provider === 'azure')).toMatchObject({
      nativeAuth: { env: ['AZURE_OPENAI_API_KEY'], oauth: false },
      baseURLEnv: ['AZURE_OPENAI_BASE_URL', 'AZURE_OPENAI_RESOURCE_NAME'],
    })
    expect(directory.find(entry => entry.provider === 'radius')?.defaultBaseURL).toBe('https://radius.pi.dev/v1')
    expect(directory.find(entry => entry.provider === 'opencode')?.defaultBaseURL).toBeUndefined()

    // Exactly what the web Models page leaves on disk.
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const result = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-flash', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
  })

  it('offers OpenAI sign-in by API key only, while other subscription logins stay', async () => {
    const { ctx } = await loadComposition()
    const methods = (provider: string): string[] | undefined => ctx.authorization.list()
      .find(entry => entry.key === LlmPiAi.recordKeyFor(provider))?.methods.map(method => method.id)

    // pi-ai's Sign in with ChatGPT needs an installation ID the harness does
    // not supply, so the route offers only its key login.
    expect(methods('openai')).toEqual(['api-key'])
    expect(methods('anthropic')).toEqual(['oauth', 'api-key'])
  })

  it('uses settings-only route headers for model discovery', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ body: JSON.stringify({ data: [{ id: 'acme-private' }] }) }])
    const { ctx, settingsPath } = await loadComposition()

    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      acme-gateway:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      '        api: openai-completions',
      `        baseURL: ${server.url}`,
      '        headers:',
      '          X-Company-Code: private-tenant',
      '          Accept: text/plain',
      '          User-Agent: deployment-owned',
      '        models:',
      '          - id: acme-bootstrap',
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['acme-gateway'])
    }, { timeout: 5000 })

    await expect(ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'acme-gateway',
      baseURL: server.url,
      api: 'openai-completions',
    })).resolves.toEqual([{ id: 'acme-private', name: 'acme-private' }])
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.['x-company-code']).toBe('private-tenant')
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
    expect(server.headers[0]?.accept).toBe('application/json')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('continues natively after max-token assembly drops a tool call, with pruned replay metadata', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([
      { events: truncatedToolCallEvents },
      { events: textEvents },
    ])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const truncated = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })
    expect(truncated.finish).toEqual({ kind: 'max-tokens' })
    expect(truncated.message.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(truncated.message.source).toEqual({
      kind: 'model',
      provider: 'deepseek',
      model: 'deepseek-flash',
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-flash',
          stopReason: 'length',
        },
        blocks: [{ type: 'text' }],
      },
    })

    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        truncated.message,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
    const followup = server.requests[1] as { messages?: unknown[] }
    expect(followup.messages?.[0]).not.toHaveProperty('tool_calls')
  })

  it('continues a legacy session whose stored replay state no longer matches its content', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    // A pre-envelope session log entry: max-token assembly dropped the tool
    // call from content while the flat v1 state still describes both blocks.
    const poisoned = createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial' }],
      source: {
        kind: 'model',
        ...{
          provider: 'deepseek',
          model: 'deepseek-flash',
          replayState: {
            kind: 'pi-ai',
            version: 1,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-flash',
            stopReason: 'length',
            blocks: [{ type: 'text' }, { type: 'tool-call' }],
          },
        },
      },
    })
    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        poisoned,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.finish).toEqual({ kind: 'stop' })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
  })
})
