/** Replay addressed argument errors and recovery through the real SDK and loop. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'

/** Cordis fixture identity. */
export const name = 'openai-tool-stream-fixture'

/**
 * Intercept only the scenario endpoint; keep streaming, tool execution, and persistence real.
 * @param ctx - Cordis context owning the interception and event observations.
 */
export function apply(ctx) {
  const events = parseSessionLog(readFileSync(process.env.DSH_SNAPSHOT_FILE, 'utf8'))
  const replies = events.filter(event => event.type === 'assistant/message')
  assert.equal(replies.length, 3)
  const initialCalls = replies[0].data.message.content.filter(block => block.type === 'tool-call')
  assert.equal(initialCalls.length, 2)
  assert.equal(initialCalls[0].name, 'write')
  JSON.parse(initialCalls[0].arguments)
  assert.throws(() => JSON.parse(initialCalls[1].arguments))
  const model = events.find(event => event.type === 'request/header').data.header.config.model
  const frame = delta => ({ choices: [{ index: 0, delta, finish_reason: null }] })
  const responses = replies.map(reply => {
    const packets = reply.data.stream.flatMap(record => {
      if (record.type === 'tool-call-chunks') return record.args.map((arguments_, offset) => frame({ tool_calls: [{
        index: record.index,
        ...offset === 0 ? { id: record.id, type: 'function' } : {},
        function: { ...offset === 0 ? { name: record.name } : {}, arguments: arguments_ },
      }] }))
      if (record.type === 'text-chunks') return record.texts.map(content => frame({ content }))
      return []
    })
    const usageRecord = reply.data.stream.find(record => record.type === 'chunk' && record.chunk.type === 'usage')
    assert.ok(usageRecord)
    const usage = usageRecord.chunk.usage
    packets.push({ choices: [{ index: 0, delta: {}, finish_reason: reply.data.message.content.some(block => block.type === 'tool-call') ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens } })
    return packets.map(packet => `data: ${JSON.stringify(packet)}\n\n`).join('') + 'data: [DONE]\n\n'
  })
  let requests = 0
  let failedAttempts = 0
  const calls = []
  const results = []
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/attempt') failedAttempts++
    if (event.type === 'tool/call') calls.push(event.data.callId)
    if (event.type === 'tool/result') results.push({ id: event.data.message.toolCallId, isError: event.data.message.isError ?? false, code: event.data.error?.code })
  })
  ctx.effect(() => {
    const original = globalThis.fetch
    const intercepted = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== 'https://gateway.invalid') return original(input, init)
      const request = new Request(input, init)
      assert.equal(url.pathname, '/v1/chat/completions')
      assert.equal(request.method, 'POST')
      const body = await request.json()
      assert.equal(body.model, model)
      if (requests > 0) {
        const replayed = body.messages.flatMap(message => message.tool_calls ?? [])
        assert.equal(replayed.find(call => call.id === initialCalls[1].id).function.arguments, initialCalls[1].arguments)
        assert.ok(body.messages.some(message => message.role === 'tool' && message.tool_call_id === initialCalls[1].id))
      }
      const response = responses[requests++]
      assert.ok(response)
      return new Response(response, { headers: { 'content-type': 'text/event-stream' } })
    }
    globalThis.fetch = intercepted
    return () => {
      const observed = globalThis.fetch
      globalThis.fetch = original
      assert.equal(observed, intercepted)
      assert.equal(requests, replies.length)
      assert.equal(failedAttempts, 0)
      const expectedCalls = replies.flatMap(reply => reply.data.message.content.filter(block => block.type === 'tool-call'))
      assert.deepEqual(calls, expectedCalls.map(call => call.id))
      assert.deepEqual(results.map(result => result.isError), [false, true, false])
      assert.equal(results[1].code, 'INVALID_ARGS')
    }
  })
}
