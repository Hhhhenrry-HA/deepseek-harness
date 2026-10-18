/** Buffered JSON tool tokens keep the provider idle watchdog alive. */

import { afterEach, expect, it, vi } from 'vitest'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => { vi.useRealTimers() })

const tools: ToolSchema[] = [{ name: 'echo', description: 'Return text.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }]

async function collect(source: AsyncIterable<StreamChunk>): Promise<BlockAssembler> {
  const assembler = new BlockAssembler()
  for await (const chunk of source) assembler.push(chunk)
  return assembler
}

it('keeps a JSON tool stream alive while buffered fragments keep arriving', async () => {
  const profiles = resolveProfiles({ gateway: {
    api: 'openai-completions', baseURL: 'https://example.test', streamIdleTimeoutMs: 20,
    models: [{ id: 'm', toolMode: 'tagged-json' }],
  } })
  const profile = profiles.get('gateway')
  if (profile?.piProvider === undefined) throw new Error('missing fixture provider')
  const source = new AssistantMessageEventStream()
  const started = Promise.withResolvers<undefined>()
  const consumed = new Map<AssistantMessageEvent, () => void>()
  const originalIterator = source[Symbol.asyncIterator]()
  source[Symbol.asyncIterator] = async function* () {
    while (true) {
      const next = await originalIterator.next()
      if (next.done) return
      const event = next.value
      yield event
      consumed.get(event)?.()
    }
  }
  profile.piProvider = { ...profile.piProvider, streamSimple: () => { started.resolve(undefined); return source } }
  const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve('test-key'), auth: memoryAuth() })
  const message: AssistantMessage = {
    role: 'assistant', api: 'openai-completions', provider: 'gateway', model: 'm', timestamp: 0,
    content: [{ type: 'text', text: '<tool_call>{"name":"echo","arguments":{"text":"hello"}}</tool_call>' }], stopReason: 'stop',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
  let settled = false
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const pending = collect(adapter.stream({ provider: 'gateway', model: 'm', messages: [], tools }))
    .then(result => ({ result, error: undefined }), (error: unknown) => ({ result: undefined, error }))
    .finally(() => { settled = true })
  try {
    await started.promise
    for (const delta of ['<tool_call>', '{"name":"echo",', '"arguments":{"text":"hello"}}', '</tool_call>']) {
      const event: AssistantMessageEvent = { type: 'text_delta', contentIndex: 0, delta, partial: message }
      const receipt = Promise.withResolvers<undefined>()
      consumed.set(event, () => { receipt.resolve(undefined) })
      source.push(event)
      await receipt.promise
      await vi.advanceTimersByTimeAsync(15)
      expect(settled).toBe(false)
    }
    source.push({ type: 'done', reason: 'stop', message })
    const outcome = await pending
    expect(outcome.error).toBeUndefined()
    expect(outcome.result?.finish).toEqual({ kind: 'tool-calls' })
    expect(outcome.result?.blocks()).toMatchObject([{ type: 'tool-call', name: 'echo' }])
  } finally {
    source.end(message)
    await pending
  }
})
