import { afterEach, describe, expect, it } from 'vitest'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages'
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import type { AssistantMessageEvent, Model } from '@earendil-works/pi-ai'
import { BlockAssembler, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { toPiContext } from '../src/context.ts'
import { toStreamChunks } from '../src/stream.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(closeMockServers)

function model<A extends 'openai-completions' | 'openai-responses' | 'anthropic-messages'>(api: A, baseUrl: string): Model<A> {
  return {
    id: 'm', name: 'm', api, provider: 'test', baseUrl, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
  }
}

async function assemble(events: AsyncIterable<AssistantMessageEvent>): Promise<BlockAssembler> {
  const assembler = new BlockAssembler()
  for await (const chunk of toStreamChunks(events)) assembler.push(chunk)
  return assembler
}

describe('malformed function-argument history', () => {
  it.each(['', '{"key":0}{"key":1}'])('replays exact raw arguments and their signature after reopening durable content: %j', async (rawArguments) => {
    const google = { thought_signature: 'opaque-signed-arguments+/=' }
    const server = await mockServer([
      { events: [
        JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: 'write', arguments: rawArguments } }] }, finish_reason: null }] }),
        JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, extra_content: { google } }] }, finish_reason: null }] }),
        '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
        '[DONE]',
      ] },
      { events: textEvents },
      { events: textEvents },
    ])
    const sourceModel = model('openai-completions', server.url)
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Write a value.' }] })
    const first = await assemble(streamSimple(sourceModel, normalizeContext(toPiContext({ provider: 'test', model: 'm', messages: [user] })), { apiKey: 'test-key', maxRetries: 0 }))
    expect(first.finish).toEqual({ kind: 'tool-calls' })
    expect(first.blocks()).toEqual([{ type: 'tool-call', id: 'call_0', name: 'write', arguments: rawArguments }])
    const history: Message[] = [
      user,
      first.message({ provider: 'test', model: 'm', replayState: first.replayState }),
      createToolResultMessage({ callId: ToolCallId('call_0'), content: [{ type: 'text', text: 'Invalid arguments.' }], isError: true }),
    ]
    const saved = JSON.stringify(history)
    const reopened = JSON.parse(saved) as Message[]
    const context = normalizeContext(toPiContext({ provider: 'test', model: 'm', messages: reopened }))
    for (let repeat = 0; repeat < 2; repeat++) {
      expect((await assemble(streamSimple(sourceModel, context, { apiKey: 'test-key', maxRetries: 0 }))).finish).toEqual({ kind: 'stop' })
      const request = server.requests[repeat + 1] as { messages: { role: string; tool_calls?: unknown[] }[] }
      expect(request.messages.find(message => message.role === 'assistant')?.tool_calls).toEqual([{
        id: 'call_0', type: 'function', function: { name: 'write', arguments: rawArguments }, extra_content: { google },
      }])
    }
    const responses = convertResponsesMessages(model('openai-responses', 'https://provider.invalid/v1'), context, new Set(['test']))
    expect(responses.find(item => 'type' in item && item.type === 'function_call')).toMatchObject({ name: 'write', arguments: rawArguments })
    let unsupportedRequests = 0
    const unsupported = await assemble(streamAnthropic(model('anthropic-messages', 'https://provider.invalid/v1'), context, {
      apiKey: 'test-key', maxRetries: 0,
      fetch: async () => {
        unsupportedRequests += 1
        throw new Error('unexpected object-argument request')
      },
    }))
    expect(unsupported.finish).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR' } })
    expect(unsupportedRequests).toBe(0)
    expect(JSON.stringify(reopened)).toBe(saved)
    expect(server.requests).toHaveLength(3)
  })
})
