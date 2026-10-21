/** Gemini replay metadata survives the OpenAI-compatible wire and durable history. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { Message } from '@deepseek-ai/dsh-llm'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const tool = { name: 'lookup', description: 'Look up a value.', parameters: { type: 'object', properties: { key: { type: 'number' } }, required: ['key'] } }
const user = (): Message => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Look up both values.' }] })

function signedEvents(google: Record<string, unknown>): string[] {
  return [
    JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [0, 1].map(index => ({ index, id: `call_${index}`, type: 'function', function: { name: 'lookup', arguments: JSON.stringify({ key: index }) } })) }, finish_reason: null }] }),
    // Signatures may arrive after the name and arguments, without repeating the id.
    JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, extra_content: { google } }] }, finish_reason: null }] }),
    JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    '[DONE]',
  ]
}

const contexts: Context[] = []
async function adapter(url: string): Promise<Context> {
  vi.stubEnv('GOOGLE_REPLAY_KEY', 'test-key')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { gateway: {
    api: 'openai-completions', baseURL: url, apiKeyEnv: 'GOOGLE_REPLAY_KEY',
    models: [{ id: 'gemini-test' }, { id: 'kimi-test' }, { id: 'gpt-test' }],
  } } })
  return ctx
}
function assistantCalls(request: unknown): Record<string, unknown>[] {
  const messages = (request as { messages: Record<string, unknown>[] }).messages
  return messages.filter(message => message['role'] === 'assistant').flatMap(message => (message['tool_calls'] ?? []) as Record<string, unknown>[])
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await closeMockServers()
  vi.unstubAllEnvs()
})

describe('OpenAI-compatible Google tool replay', () => {
  it.each(['thought_signature', 'thoughtSignature'])('preserves %s only on its original call and model', async (key) => {
    const google = { [key]: 'opaque-signature+/=' }
    const server = await mockServer([
      { events: signedEvents(google) }, { events: textEvents }, { events: textEvents }, { events: textEvents },
    ])
    const client = await adapter(server.url)
    const messages: Message[] = [user()]
    const first = await assemble(client, { provider: 'gateway', model: 'gemini-test', messages, tools: [tool] })
    expect(first.finish).toEqual({ kind: 'tool-calls' })
    const calls = first.message.content.filter(block => block.type === 'tool-call')
    expect(calls).toHaveLength(2)
    messages.push(first.message, ...calls.map(call => createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: 'value' }], isError: false })))
    const saved = JSON.stringify(messages)
    const restored = JSON.parse(saved) as Message[]
    for (const model of ['gemini-test', 'kimi-test', 'gpt-test']) {
      expect((await assemble(client, { provider: 'gateway', model, messages: restored, tools: [tool] })).finish).toEqual({ kind: 'stop' })
    }
    const replay = assistantCalls(server.requests[1])
    expect(replay[0]).toEqual({ id: 'call_0', type: 'function', function: { name: 'lookup', arguments: '{"key":0}' }, extra_content: { google } })
    expect(replay[1]).toEqual({ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"key":1}' } })
    for (const request of server.requests.slice(2)) {
      expect(assistantCalls(request).every(call => call['extra_content'] === undefined)).toBe(true)
    }
    expect(JSON.stringify(restored)).toBe(saved)
  })

  it('retains legacy encrypted reasoning without treating it as a Google signature', async () => {
    const server = await mockServer([{ events: textEvents }])
    const detail = { type: 'reasoning.encrypted', id: 'call_legacy', data: 'opaque-openrouter-data' }
    const messages = [user(), createAssistantMessage({
      content: [{ type: 'tool-call', id: ToolCallId('call_legacy'), name: 'lookup', arguments: '{}' }],
      source: { provider: 'gateway', model: 'kimi-test', replayState: {
        response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'gateway', model: 'kimi-test', stopReason: 'toolUse' },
        blocks: [{ type: 'tool-call', thoughtSignature: JSON.stringify(detail) }],
      } },
    }), createToolResultMessage({ callId: ToolCallId('call_legacy'), content: [{ type: 'text', text: 'value' }], isError: false })]
    expect((await assemble(await adapter(server.url), { provider: 'gateway', model: 'kimi-test', messages, tools: [tool] })).finish).toEqual({ kind: 'stop' })
    const request = server.requests[0] as { messages: Record<string, unknown>[] }
    expect(request.messages.find(message => message['role'] === 'assistant')).toHaveProperty('reasoning_details', [detail])
    expect(assistantCalls(request)[0]).not.toHaveProperty('extra_content')
  })

  it.each(['', 12, null])('rejects malformed signed responses before accepting tool calls: %j', async (signature) => {
    const server = await mockServer([{ events: signedEvents({ thought_signature: signature }) }])
    const result = await assemble(await adapter(server.url), { provider: 'gateway', model: 'gemini-test', messages: [user()], tools: [tool] })
    expect(result.finish.kind).toBe('error')
  })
})
