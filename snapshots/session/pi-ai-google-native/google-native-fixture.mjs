/** Replay native Gemini SSE through the shipped headless profile without endpoint I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'

/** Cordis fixture identity. */
export const name = 'google-native-fixture'

/**
 * Keep SDK serialization, tool execution, and Session persistence real.
 * @param ctx - Context owning the interception and event observations.
 */
export function apply(ctx) {
  const events = parseSessionLog(readFileSync(process.env.DSH_SNAPSHOT_FILE, 'utf8'))
  const replies = events.filter(event => event.type === 'assistant/message')
  assert.equal(replies.length, 2)
  const calls = replies[0].data.message.content.filter(block => block.type === 'tool-call')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(call => call.name), ['write', 'write'])
  const signature = replies[0].data.message.source.replayState.blocks[0].thoughtSignature
  assert.equal(typeof signature, 'string')
  const parts = calls.map((call, index) => ({
    functionCall: { id: call.id, name: call.name, args: JSON.parse(call.arguments) },
    ...index === 0 ? { thoughtSignature: signature } : {},
  }))
  const packet = content => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: content }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 } })}\n\n`
  const responses = [packet(parts), packet([{ text: 'DONE' }])]
  let requests = 0
  const results = []
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/attempt') assert.fail('native fixture produced a failed attempt')
    if (event.type === 'tool/result') results.push(event.data.message)
  })
  ctx.effect(() => {
    const original = globalThis.fetch
    const intercepted = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== 'https://gemini-native.invalid') return original(input, init)
      const request = new Request(input, init)
      assert.equal(url.pathname, '/relay/v1beta/models/gemini-test:streamGenerateContent')
      assert.equal(url.search, '?alt=sse')
      assert.equal(request.method, 'POST')
      assert.equal(request.headers.get('x-goog-api-key'), 'snapshot-key')
      assert.equal(request.headers.get('authorization'), null)
      const body = await request.json()
      assert.equal(body.model, undefined)
      const declarations = body.tools.flatMap(tool => tool.functionDeclarations ?? [])
      const write = declarations.find(tool => tool.name === 'write')
      assert.ok(write.parametersJsonSchema)
      assert.equal(write.parameters, undefined)
      if (requests === 1) {
        const model = body.contents.find(content => content.role === 'model')
        // Unknown aliases omit IDs on Google's native wire; the two calls stay ordered.
        assert.deepEqual(model.parts, parts.map(({ functionCall, ...part }) => ({
          ...part, functionCall: { name: functionCall.name, args: functionCall.args },
        })))
        const responses = body.contents.flatMap(content => content.parts).filter(part => part.functionResponse)
        assert.ok(responses.every(part => part.functionResponse.id === undefined))
        assert.equal(responses.length, 2)
        assert.deepEqual(responses.map(part => part.functionResponse.name), ['write', 'write'])
        assert.ok(responses[0].functionResponse.response.output.includes('first.txt'))
        assert.ok(responses[1].functionResponse.response.output.includes('second.txt'))
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
      assert.equal(requests, 2)
      assert.equal(results.length, 2)
      assert.ok(results.every(result => !result.isError))
    }
  })
}
