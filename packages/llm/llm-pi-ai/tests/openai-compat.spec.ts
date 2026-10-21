/** Model-name wire defaults of custom `openai-completions` routes, from resolution to the request body. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  ReasoningEffortId,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import type { Options } from '../src/config.ts'
import { openAiCompletionsNameCompat } from '../src/openai-compat.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(closeMockServers)

const GATEWAY_WIRE = { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' }
const DEEPSEEK_WIRE = {
  ...GATEWAY_WIRE,
  requiresReasoningContentOnAssistantMessages: true,
}

type Providers = NonNullable<Options['providers']>

const echoTool: ToolSchema = {
  name: 'echo',
  description: 'Return text.',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
}

/** The compat each model of one route materializes, by id. */
function compatOf(providers: Providers, route = 'gateway'): Record<string, unknown> {
  const models = resolveProfiles(providers).get(route)?.piProvider?.getModels() ?? []
  return Object.fromEntries(models.map(model => [model.id, model.compat]))
}

function custom(models: NonNullable<Providers[string]['models']>, extra: Partial<Providers[string]> = {}): Providers {
  return { gateway: { api: 'openai-completions', baseURL: 'https://gateway.test/v1', models, ...extra } }
}

describe('openAiCompletionsNameCompat', () => {
  it.each([
    ['deepseek-v4-pro', DEEPSEEK_WIRE],
    ['relay/Experimental-DeepSeek-R1', DEEPSEEK_WIRE],
    ['gemini-3-pro', GATEWAY_WIRE],
    ['models/Gemini-2.5-Flash', GATEWAY_WIRE],
    ['deepseek-gemini-distill', DEEPSEEK_WIRE],
  ])('names %s by family', (id, expected) => {
    expect(openAiCompletionsNameCompat(id)).toEqual(expected)
  })

  it.each(['gpt-5', 'o3-mini', 'kimi-k3', 'moonshot-v1', 'claude-sonnet-4', 'qwen3-max'])('leaves %s without defaults', (id) => {
    expect(openAiCompletionsNameCompat(id)).toEqual({})
  })
})

describe('compat resolution on a custom completions route', () => {
  it('applies each family default and nothing to other models', () => {
    expect(compatOf(custom([{ id: 'deepseek-v4' }, { id: 'gemini-3-pro' }, { id: 'gpt-5' }, { id: 'kimi-k3' }]))).toEqual({
      'deepseek-v4': DEEPSEEK_WIRE,
      'gemini-3-pro': GATEWAY_WIRE,
      'gpt-5': undefined,
      'kimi-k3': undefined,
    })
  })

  it('lets explicit route compat win field by field', () => {
    expect(compatOf(custom([{ id: 'gemini-3-pro' }], { compat: { supportsStore: true } }))).toEqual({
      'gemini-3-pro': { ...GATEWAY_WIRE, supportsStore: true },
    })
  })

  it('lets explicit model compat win over route compat and defaults', () => {
    expect(compatOf(custom(
      [{ id: 'deepseek-v4', compat: { maxTokensField: 'max_completion_tokens', thinkingFormat: 'openai' } }],
      { compat: { maxTokensField: 'max_tokens', supportsDeveloperRole: true } },
    ))).toEqual({
      'deepseek-v4': {
        ...DEEPSEEK_WIRE, supportsDeveloperRole: true, maxTokensField: 'max_completion_tokens', thinkingFormat: 'openai',
      },
    })
  })

  it('lets an explicit false beat a true default', () => {
    expect(compatOf(custom([{ id: 'deepseek-v4', compat: { requiresReasoningContentOnAssistantMessages: false } }])))
      .toEqual({ 'deepseek-v4': { ...DEEPSEEK_WIRE, requiresReasoningContentOnAssistantMessages: false } })
  })

  it('leaves reasoning capability as declared', () => {
    const models = resolveProfiles(custom([
      { id: 'deepseek-plain' },
      { id: 'deepseek-declared', reasoningEfforts: { off: null, high: 'high' } },
    ])).get('gateway')?.piProvider?.getModels() ?? []
    expect(models.map(model => [model.id, model.reasoning])).toEqual([['deepseek-plain', false], ['deepseek-declared', true]])
    expect(models[1]?.thinkingLevelMap).toMatchObject({ high: 'high' })
  })

  it.each(['anthropic-messages', 'openai-responses'] as const)('does not apply to %s', (api) => {
    expect(compatOf(custom([{ id: 'gemini-3-pro' }], { api }))).toEqual({ 'gemini-3-pro': undefined })
  })

  it('does not apply to a route the installed catalog describes', () => {
    const providers: Providers = { openrouter: { models: [{ id: 'deepseek/deepseek-r1' }] } }
    const compat = compatOf(providers, 'openrouter')['deepseek/deepseek-r1']
    expect(compat).toMatchObject({ thinkingFormat: 'openrouter' })
    expect(compat).not.toHaveProperty('maxTokensField')
    expect(compat).not.toHaveProperty('supportsStore')
  })

  it('keeps an installed catalog model\'s own compat untouched', () => {
    const base = getBuiltinModels('deepseek').find(model => model.id === 'deepseek-v4-pro')
    expect(base?.compat).toBeDefined()
    const providers: Providers = { deepseek: { models: [{ id: 'deepseek-v4-pro' }] } }
    expect(compatOf(providers, 'deepseek')).toEqual({ 'deepseek-v4-pro': base?.compat })
  })
})

describe('request body of a custom completions route', () => {
  async function requestOf(
    models: NonNullable<Providers[string]['models']>,
    model: string,
    effort?: string,
    extra: Partial<Providers[string]> = {},
    tools?: ToolSchema[],
    endpointHint = '',
  ): Promise<Record<string, unknown>> {
    const server = await mockServer([{ events: textEvents }])
    const providers = custom(models, { baseURL: `${server.url}/v1/${endpointHint}`, ...extra })
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles(providers),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
    })
    for await (const _chunk of adapter.stream({
      provider: 'gateway',
      model,
      maxTokens: 321,
      ...tools === undefined ? {} : { tools },
      messages: [createSystemMessage('be brief'), createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'user' },
      })],
      ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
    })) { /* drain */ }
    return server.requests[0] as Record<string, unknown>
  }

  it.each(['deepseek-v4-pro', 'gemini-3-pro'])('sends the gateway wire format for %s', async (model) => {
    const body = await requestOf([{ id: model }], model)
    expect(body).toMatchObject({ model, max_tokens: 321, messages: [{ role: 'system', content: 'be brief' }, { role: 'user' }] })
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('store')
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it.each(['gpt-5', 'kimi-k3'])('keeps the generic wire format for %s', async (model) => {
    const body = await requestOf([{ id: model }], model)
    expect(body).toMatchObject({ max_completion_tokens: 321, store: false })
    expect(body).not.toHaveProperty('max_tokens')
  })

  it.each(['deepseek-v4-pro', 'gemini-3-pro'])('applies the gateway wire format to JSON tool mode for %s', async (model) => {
    const body = await requestOf([{ id: model, toolMode: 'tagged-json' }], model, undefined, {}, [echoTool])
    expect(body).toMatchObject({ max_tokens: 321 })
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('store')
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body['messages']).toMatchObject([{ role: 'system' }, { role: 'user' }])
  })

  it.each([
    ['openrouter.ai', { effort: 'high' }],
    ['api.together.ai', { enabled: true }],
    ['api.ant-ling.com', { effort: 'high' }],
  ] as const)('retains the recognized %s reasoning dialect on an aliased custom route', async (endpointHint, reasoning) => {
    const body = await requestOf([
      { id: 'deepseek-v4-pro', reasoningEfforts: { high: 'high' } },
    ], 'deepseek-v4-pro', 'high', {}, undefined, endpointHint)
    expect(body).toHaveProperty('reasoning', reasoning)
    expect(body).not.toHaveProperty('thinking')
  })

  it('lets an explicit thinking dialect override endpoint detection', async () => {
    const body = await requestOf([
      { id: 'deepseek-v4-pro', reasoningEfforts: { high: 'high' }, compat: { thinkingFormat: 'deepseek' } },
    ], 'deepseek-v4-pro', 'high', {}, undefined, 'openrouter.ai')
    expect(body).toHaveProperty('thinking', { type: 'enabled' })
    expect(body).not.toHaveProperty('reasoning')
  })

  it('retains native OpenCode reasoning parameters for its installed DeepSeek entry', async () => {
    const server = await mockServer([{ events: textEvents }])
    const profiles = resolveProfiles({ opencode: {
      baseURL: server.url, models: [{ id: 'deepseek-v4-flash' }],
    } })
    const adapter = new PiAiAdapter({
      profiles: () => profiles, resolveApiKey: () => Promise.resolve('test-key'), auth: memoryAuth(),
    })
    for await (const _chunk of adapter.stream({
      provider: 'opencode', model: 'deepseek-v4-flash', reasoningEffort: ReasoningEffortId('high'), messages: [],
    })) { /* drain */ }
    expect(server.requests[0]).toHaveProperty('reasoning_effort', 'high')
    expect(server.requests[0]).not.toHaveProperty('thinking')
  })

  it('dispatches a declared DeepSeek effort as thinking plus reasoning_effort', async () => {
    const body = await requestOf([{ id: 'deepseek-v4-pro', reasoningEfforts: { off: null, high: 'high', max: 'max' } }], 'deepseek-v4-pro', 'max')
    expect(body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'max', max_tokens: 321 })
  })

  it('keeps explicit off disabling declared DeepSeek thinking', async () => {
    const body = await requestOf([{ id: 'deepseek-v4-pro', reasoningEfforts: { off: 'off', high: 'high' } }], 'deepseek-v4-pro', 'off')
    expect(body).toMatchObject({ thinking: { type: 'disabled' } })
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('replays an empty reasoning_content on a DeepSeek tool-call turn without a reasoning declaration', async () => {
    const server = await mockServer([{ events: textEvents }])
    const providers = custom([{ id: 'deepseek-v4-pro' }], { baseURL: `${server.url}/v1` })
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles(providers),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
    })
    for await (const _chunk of adapter.stream({
      provider: 'gateway',
      model: 'deepseek-v4-pro',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
        createAssistantMessage({
          content: [{ type: 'tool-call', id: ToolCallId('call_1'), name: 'lookup', arguments: '{}' }],
          source: { provider: 'gateway', model: 'deepseek-v4-pro' },
        }),
        createToolResultMessage({ callId: ToolCallId('call_1'), content: [{ type: 'text', text: 'done' }], isError: false }),
      ],
    })) { /* drain */ }
    const body = server.requests[0] as { messages: Record<string, unknown>[] }
    expect(body.messages.find(message => message['role'] === 'assistant')).toHaveProperty('reasoning_content', '')
  })
})
