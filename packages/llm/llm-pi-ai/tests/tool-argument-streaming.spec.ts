import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantMessageEvent, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages'
import { stream as streamCompletions, streamSimple as streamSimpleCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { stream as streamResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { toStreamChunks } from '../src/stream.ts'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { anthropicFrame as frame, anthropicMessageStart, closeMockServers, mockServer } from './mock-server.ts'

afterEach(closeMockServers)

/** A write call whose arguments arrive in many small deltas. */
const args = { file_path: 'notes.md', content: 'x'.repeat(2048) }
const argsJson = JSON.stringify(args)
const fragments = argsJson.match(/.{1,7}/gs) ?? []

function model<A extends 'anthropic-messages' | 'openai-completions' | 'openai-responses'>(api: A, baseUrl: string): Model<A> {
  return {
    id: 'm', name: 'm', api, provider: 'test', baseUrl, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
  }
}

/** The arguments each `toolcall_delta` partial carries, and the finalized arguments. */
async function collect(events: AsyncIterable<AssistantMessageEvent>): Promise<{ partials: unknown[]; final: unknown }> {
  const partials: unknown[] = []
  let final: unknown
  for await (const event of events) {
    if (event.type === 'toolcall_delta' && event.delta.length > 0) {
      const block = event.partial.content[event.contentIndex]
      partials.push(block?.type === 'toolCall' ? block.arguments : undefined)
    } else if (event.type === 'toolcall_end') {
      final = event.toolCall.arguments
    } else if (event.type === 'error') {
      throw new Error(event.error.errorMessage)
    }
  }
  return { partials, final }
}

const context = normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 0 }] })

interface ToolDelta {
  index?: number
  id?: string
  type?: 'function' | 'custom' | ''
  function?: { name?: string; arguments?: string }
  custom?: { name?: string; input?: string }
  extra_content?: { google: { thought_signature: string } }
}

/** Exercise the real SDK parser and Harness assembly without acquiring a network listener. */
async function completions(
  deltas: { tool_calls?: ToolDelta[]; content?: string }[],
  finish: string | null = 'tool_calls',
  overrides: Partial<Model<'openai-completions'>> = {},
  options: Pick<SimpleStreamOptions, 'signal' | 'onProviderStreamEvent'> = {},
): Promise<{ assembler: BlockAssembler; endedCalls: unknown[]; requests: number }> {
  const payload = [
    ...deltas.map(delta => ({ choices: [{ index: 0, delta, finish_reason: null }] })),
    ...finish === null ? [] : [{ choices: [{ index: 0, delta: {}, finish_reason: finish }] }],
  ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  let requests = 0
  const source = streamSimpleCompletions({ ...model('openai-completions', 'https://provider.invalid/v1'), ...overrides }, context, {
    apiKey: 'test-key',
    maxRetries: 0,
    ...options,
    fetch: async () => {
      requests += 1
      return new Response(payload, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  const endedCalls: unknown[] = []
  async function* observed(): AsyncGenerator<AssistantMessageEvent> {
    for await (const event of source) {
      if (event.type === 'toolcall_end') endedCalls.push(event.toolCall)
      yield event
    }
  }
  const assembler = new BlockAssembler()
  for await (const chunk of toStreamChunks(observed())) assembler.push(chunk)
  return { assembler, endedCalls, requests }
}

const functionCall = (arguments_: string, index = 0, id = 'call_0'): ToolDelta => ({
  index, id, type: 'function', function: { name: 'write', arguments: arguments_ },
})

function expectProtocolFailure(result: Awaited<ReturnType<typeof completions>>): void {
  expect(result.assembler.finish).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR' } })
  expect(result.requests).toBe(1)
}

function expectRawCall(result: Awaited<ReturnType<typeof completions>>, rawArguments: string): void {
  expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
  expect(result.endedCalls).toEqual([{ type: 'toolCall', id: 'call_0', name: 'write', arguments: {}, rawArguments }])
  expect(result.assembler.blocks()).toEqual([{ type: 'tool-call', id: 'call_0', name: 'write', arguments: rawArguments }])
  expect(result.requests).toBe(1)
}

describe('OpenAI-compatible function-call finalization', () => {
  it.each([2, 3])('retains %i complete objects accumulated for one addressed tool call without selecting one', async (count) => {
    const result = await completions(Array.from({ length: count }, (_, index) => ({
      tool_calls: [index === 0 ? functionCall('{"key":0}') : { index: 0, function: { arguments: JSON.stringify({ key: index }) } }],
    })))
    expectRawCall(result, Array.from({ length: count }, (_, key) => JSON.stringify({ key })).join(''))
  })

  it.each([
    ['two objects in one delta', '{"key":0}{"key":1}'],
    ['trailing text', '{"key":0} secret_500'],
    ['incomplete object', '{"key":'],
    ['invalid escape', '{"path":"C:\\secret_500"}'],
    ['unescaped newline', '{"text":"secret_500\nnext"}'],
    ['array', '[{"key":0}]'],
    ['null', 'null'],
    ['string', '"secret_500"'],
    ['number', '500'],
    ['boolean', 'false'],
    ['empty stream', ''],
    ['whitespace only', ' \n\t '],
  ])('retains %s verbatim for the addressed call to reject', async (_label, arguments_) => {
    const result = await completions([{ tool_calls: [functionCall(arguments_)] }])
    expectRawCall(result, arguments_)
  })

  it('preserves absent arguments as an empty raw stream rather than inventing an empty object', async () => {
    const result = await completions([{ tool_calls: [{ index: 0, id: 'call_0', function: { name: 'write' } }] }])
    expectRawCall(result, '')
  })

  it('accepts an explicit empty object with surrounding JSON whitespace', async () => {
    const result = await completions([{ tool_calls: [functionCall(' \n{}\t ')] }])
    expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(result.assembler.blocks()).toEqual([{ type: 'tool-call', id: 'call_0', name: 'write', arguments: '{}' }])
  })

  it('assembles interleaved indices, late ids, id-only continuations and signed empty deltas separately', async () => {
    const google = { thought_signature: 'opaque+/=' }
    const result = await completions([
      { tool_calls: [{ index: 0, id: '', type: '', function: { name: '', arguments: '{"key":' } }, functionCall('{"key":', 1, 'call_1')] },
      { tool_calls: [{ index: 1, function: { arguments: '1}' } }, { index: 0, id: 'call_0', function: { name: 'write', arguments: '0' } }] },
      { tool_calls: [{ id: 'call_0', function: { arguments: '}' } }] },
      { tool_calls: [{ index: 0, extra_content: { google } }] },
    ])
    expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(result.assembler.blocks()).toEqual([0, 1].map(index => ({
      type: 'tool-call', id: `call_${index}`, name: 'write', arguments: JSON.stringify({ key: index }),
    })))
    expect(result.assembler.replayState?.blocks).toEqual([
      { type: 'tool-call', thoughtSignature: JSON.stringify({ type: 'google-thought-signature', google }) },
      { type: 'tool-call' },
    ])
  })

  it('binds an id-only call to its index when the index arrives later', async () => {
    const result = await completions([
      { tool_calls: [{ id: 'call_0', function: { arguments: '{"key":' } }] },
      { tool_calls: [{ index: 0, id: 'call_0', function: { name: 'write', arguments: '0}' } }] },
    ])
    expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(result.assembler.blocks()).toEqual([{ type: 'tool-call', id: 'call_0', name: 'write', arguments: '{"key":0}' }])
  })

  it.each([
    ['index changes id', [functionCall('{"key":0}')], { index: 0, id: 'other_500' }],
    ['id changes index', [functionCall('{"key":0}')], { index: 500, id: 'call_0' }],
    ['crossed index/id bindings', [functionCall('{"key":0}'), functionCall('{"key":1}', 1, 'call_1')], { index: 0, id: 'call_1' }],
    ['name changes', [functionCall('{"key":0}')], { index: 0, function: { name: 'other_500' } }],
    ['function changes to custom', [functionCall('{"key":0}')], { index: 0, type: 'custom', custom: { name: 'write', input: 'next' } }],
  ] satisfies [string, ToolDelta[], ToolDelta][])('rejects inconsistent identities: %s', async (_label, initial, next) => {
    const result = await completions([{ tool_calls: initial }, { tool_calls: [next] }])
    expectProtocolFailure(result)
    expect(result.endedCalls).toEqual([])
  })

  it.each([
    ['unaddressed delta', { function: { name: 'write', arguments: '{}' } }],
    ['negative index', functionCall('{}', -1)],
    ['fractional index', functionCall('{}', 0.5)],
    ['mixed call types', { ...functionCall('{}'), custom: { name: 'write', input: 'raw' } }],
  ] satisfies [string, ToolDelta][])('rejects %s', async (_label, call) => {
    expectProtocolFailure(await completions([{ tool_calls: [call] }]))
  })

  it('preserves custom grammar input without parsing it as function JSON', async () => {
    const input = 'not JSON: {"key":0}{"key":1}\nnext'
    const result = await completions([
      { tool_calls: [{ index: 0, id: 'call_0', type: 'custom', custom: { name: 'write', input: input.slice(0, 8) } }] },
      { tool_calls: [{ index: 0, custom: { input: input.slice(8) } }] },
    ])
    expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(result.assembler.blocks()).toEqual([{ type: 'tool-call', id: 'call_0', name: 'write', arguments: JSON.stringify({ input }) }])
  })

  it.each(['length', 'content_filter', 'network_error'])('keeps the %s terminal outcome when function arguments are incomplete', async (finish) => {
    const result = await completions([{ content: 'kept text', tool_calls: [functionCall('{"key":')] }], finish)
    expect(result.endedCalls).toEqual([])
    if (finish === 'length') {
      expect(result.assembler.finish).toEqual({ kind: 'max-tokens' })
      expect(result.assembler.blocks()).toEqual([{ type: 'text', text: 'kept text' }])
      expect(result.assembler.replayState?.blocks).toEqual([{ type: 'text' }])
    } else {
      expect(result.assembler.finish).toMatchObject({ kind: 'error' })
      expect(result.assembler.replayState).toBeUndefined()
    }
  })

  it('keeps max-token finalization for complete arguments while assembly drops all tool calls and their replay entries', async () => {
    const result = await completions([{ content: 'kept text', tool_calls: [functionCall('{}'), functionCall('{"key":', 1, 'call_1')] }], 'length')
    expect(result.assembler.finish).toEqual({ kind: 'max-tokens' })
    expect(result.endedCalls).toHaveLength(1)
    expect(result.assembler.blocks()).toEqual([{ type: 'text', text: 'kept text' }])
    expect(result.assembler.replayState?.blocks).toEqual([{ type: 'text' }])
  })

  it('preserves escaped strings and nested values split at every JSON character', async () => {
    const arguments_ = { text: 'braces }{ quote " slash \\ newline \n', nested: [1, null, true, { value: '中文😀' }] }
    const json = JSON.stringify(arguments_)
    const result = await completions([
      { tool_calls: [functionCall('')] },
      ...Array.from(json, fragment => ({ tool_calls: [{ index: 0, function: { arguments: fragment } }] })),
    ])
    expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(result.assembler.blocks()).toEqual([{ type: 'tool-call', id: 'call_0', name: 'write', arguments: json }])
  })

  it.each(['id', 'name'])('rejects a finalized call whose %s never arrived', async (field) => {
    const call = functionCall('{}')
    if (field === 'id') call.id = ''
    else call.function = { name: '', arguments: '{}' }
    expectProtocolFailure(await completions([{ tool_calls: [call] }]))
  })

  it('keeps cancellation as the terminal outcome instead of parsing incomplete arguments', async () => {
    const controller = new AbortController()
    let received = 0
    const result = await completions([{ tool_calls: [functionCall('{"key":')] }], 'tool_calls', {}, {
      signal: controller.signal,
      onProviderStreamEvent: () => { if (++received === 2) controller.abort() },
    })
    expect(result.assembler.finish).toMatchObject({ kind: 'aborted', failure: { code: 'ABORTED' } })
    expect(result.endedCalls).toEqual([])
    expect(result.assembler.replayState).toBeUndefined()
  })

  it('reports a missing terminal reason before finalizing function arguments', async () => {
    const result = await completions([{ tool_calls: [functionCall('{"key":')] }], null)
    expect(result.assembler.finish).toMatchObject({ kind: 'error', failure: { code: 'TRANSPORT' } })
    expect(result.endedCalls).toEqual([])
  })

  it('infers tool calls without finish_reason only when configured by the endpoint', async () => {
    const result = await completions([{ tool_calls: [functionCall('{}')] }], null, { compat: { supportsFinishReason: false } })
    expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(result.assembler.blocks()).toEqual([{ type: 'tool-call', id: 'call_0', name: 'write', arguments: '{}' }])
  })

  it('keeps independently addressed valid and malformed calls in the same response', async () => {
    const malformed = '{"key":0}{"key":1}'
    const result = await completions([{ tool_calls: [functionCall('{}'), functionCall(malformed, 1, 'call_1')] }])
    expect(result.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(result.endedCalls).toEqual([
      { type: 'toolCall', id: 'call_0', name: 'write', arguments: {} },
      { type: 'toolCall', id: 'call_1', name: 'write', arguments: {}, rawArguments: malformed },
    ])
    expect(result.assembler.blocks()).toEqual([
      { type: 'tool-call', id: 'call_0', name: 'write', arguments: '{}' },
      { type: 'tool-call', id: 'call_1', name: 'write', arguments: malformed },
    ])
    expect(result.assembler.replayState?.blocks).toEqual([{ type: 'tool-call' }, { type: 'tool-call' }])
  })

  it('preserves malformed arguments when a compatible endpoint omits finish_reason', async () => {
    const malformed = '{"key":0}{"key":1}'
    const result = await completions([{ tool_calls: [functionCall(malformed)] }], null, { compat: { supportsFinishReason: false } })
    expectRawCall(result, malformed)
  })
})

describe('streamed tool-call arguments (patched pi-ai)', () => {
  it('preserves an empty Responses message after parallel tool calls with its replay metadata', async () => {
    const calls = [0, 1, 2].map(index => ({ type: 'function_call', call_id: `call_${index}`, id: `item_${index}`, name: 'read', arguments: '{}' }))
    const empty = { type: 'message', id: 'message_empty', role: 'assistant', content: [{ type: 'output_text', text: '', annotations: [] }] }
    const server = await mockServer([{ events: [
      '{"type":"response.created","response":{"id":"response_empty_text"}}',
      ...[...calls, empty].flatMap((item, output_index) => [
        JSON.stringify({ type: 'response.output_item.added', output_index, item }),
        JSON.stringify({ type: 'response.output_item.done', output_index, item }),
      ]),
      JSON.stringify({ type: 'response.completed', response: {
        id: 'response_empty_text', status: 'completed', output: [...calls, empty], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      } }),
    ] }])
    const assembler = new BlockAssembler()
    for await (const chunk of toStreamChunks(streamResponses(model('openai-responses', server.url), context, { apiKey: 'test-key' }))) {
      assembler.push(chunk)
    }
    expect(assembler.blocks()).toEqual([
      ...calls.map(call => ({ type: 'tool-call', id: `${call.call_id}|${call.id}`, name: 'read', arguments: '{}' })),
      { type: 'text', text: '' },
    ])
    expect(assembler.replayState?.blocks).toEqual([
      ...calls.map(() => ({ type: 'tool-call' })),
      { type: 'text', textSignature: JSON.stringify({ v: 1, id: 'message_empty' }) },
    ])
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(server.requests).toHaveLength(1)
  })

  it('openai-completions parses arguments once, at the end of the call', async () => {
    const server = await mockServer([{ events: [
      JSON.stringify({ choices: [{
        delta: {
          role: 'assistant',
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write', arguments: '' } }],
        },
        index: 0, finish_reason: null,
      }] }),
      ...fragments.map(fragment => JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fragment } }] }, index: 0, finish_reason: null }],
      })),
      '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      '[DONE]',
    ] }])
    const events = streamCompletions(model('openai-completions', server.url), context, { apiKey: 'test-key' })
    const { partials, final } = await collect(events)
    expect(partials).toHaveLength(fragments.length)
    expect(partials.every(partial => JSON.stringify(partial) === '{}')).toBe(true)
    expect(final).toEqual(args)
  })

  it('anthropic-messages parses arguments once, at the end of the call', async () => {
    const server = await mockServer([{ events: [
      anthropicMessageStart,
      frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'write', input: {} } }),
      ...fragments.map(fragment => frame({
        type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: fragment },
      })),
      frame({ type: 'content_block_stop', index: 0 }),
      frame({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }),
      frame({ type: 'message_stop' }),
    ] }])
    const events = streamAnthropic(model('anthropic-messages', server.url), context, { apiKey: 'test-key' })
    const { partials, final } = await collect(events)
    expect(partials).toHaveLength(fragments.length)
    expect(partials.every(partial => JSON.stringify(partial) === '{}')).toBe(true)
    expect(final).toEqual(args)
  })

  it('openai-responses parses arguments once, at the end of the call', async () => {
    const item = { type: 'function_call', call_id: 'call_1', id: 'fc_1', name: 'write' }
    const server = await mockServer([{ events: [
      '{"type":"response.created","response":{"id":"resp_1"}}',
      JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } }),
      ...fragments.map(fragment => JSON.stringify({ type: 'response.function_call_arguments.delta', output_index: 0, delta: fragment })),
      JSON.stringify({ type: 'response.function_call_arguments.done', output_index: 0, arguments: argsJson }),
      JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { ...item, arguments: argsJson } }),
      JSON.stringify({ type: 'response.completed', response: {
        id: 'resp_1', status: 'completed', output: [], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      } }),
    ] }])
    const events = streamResponses(model('openai-responses', server.url), context, { apiKey: 'test-key' })
    const { partials, final } = await collect(events)
    expect(partials).toHaveLength(fragments.length)
    expect(partials.every(partial => JSON.stringify(partial) === '{}')).toBe(true)
    expect(final).toEqual(args)
  })
})
