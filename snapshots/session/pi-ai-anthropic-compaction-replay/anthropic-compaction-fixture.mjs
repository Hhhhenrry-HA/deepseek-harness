/** Anthropic transport replay with a committed checkpoint between signed tool steps. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'

/** Cordis fixture identity. */
export const name = 'anthropic-compaction-fixture'

function nativeBlocks(message) {
  return message.content.map((block, index) => {
    const replay = message.source.replayState.blocks[index]
    switch (block.type) {
      case 'reasoning':
        return replay.redacted
          ? { type: 'redacted_thinking', data: replay.thinkingSignature }
          : { type: 'thinking', thinking: block.text, signature: replay.thinkingSignature }
      case 'text': return { type: 'text', text: block.text }
      case 'tool-call': return { type: 'tool_use', id: block.id, name: block.name, input: JSON.parse(block.arguments) }
      default: throw new Error(`Unsupported authored Anthropic block: ${block.type}`)
    }
  })
}

function responseFor(message) {
  const blocks = nativeBlocks(message)
  const frame = data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`
  const events = [
    { type: 'message_start', message: {
      id: 'msg_snapshot', type: 'message', role: 'assistant', model: message.source.model, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 },
    } },
    ...blocks.flatMap((content_block, index) => [
      { type: 'content_block_start', index, content_block: content_block.type === 'tool_use'
        ? { ...content_block, input: {} } : content_block },
      ...content_block.type === 'tool_use' ? [{ type: 'content_block_delta', index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(content_block.input) } }] : [],
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: {
      stop_reason: blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null,
    }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

/**
 * Mock only the private provider endpoint; the shipped loop, pi-ai conversion, and Session persistence remain real.
 * @param ctx - Cordis context owning the transport interception and checkpoint fixture.
 */
export function apply(ctx) {
  const assistants = parseSessionLog(readFileSync(process.env.DSH_SNAPSHOT_FILE, 'utf8'))
    .filter(event => event.type === 'assistant/message').map(event => event.data.message)
  assert.equal(assistants.length, 3)
  assert.deepEqual(nativeBlocks(assistants[0]).slice(0, 2).map(block => block.type), ['thinking', 'redacted_thinking'])
  assert.equal(nativeBlocks(assistants[1])[0].type, 'thinking')
  let calls = 0
  let checkpointCommitted = false
  let original
  ctx.on('session/event', (session, event) => {
    if (original === undefined && event.type === 'user/message' && event.data.source.kind === 'user') {
      original = { sessionId: session.id, seq: event.seq }
    }
  })
  ctx.effect(() => {
    const originalFetch = globalThis.fetch
    const fixtureFetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.hostname !== 'snapshot-anthropic.invalid') return originalFetch(input, init)
      const request = new Request(input, init)
      try {
        assert.equal(url.pathname, '/v1/messages')
        assert.equal(request.method, 'POST')
        assert.equal(request.headers.get('x-api-key'), 'snapshot-key')
        const body = await request.json()
        assert.equal(body.model, assistants[0].source.model)
        const history = body.messages.filter(message => message.role === 'assistant')
        assert.equal(history.length, calls)
        if (calls > 0) {
          assert.equal(checkpointCommitted, true)
          const stale = history[0].content
          assert.equal(stale.some(block => block.type === 'thinking' || block.type === 'redacted_thinking'), false)
          const retained = nativeBlocks(assistants[0]).filter(block => block.type === 'text' || block.type === 'tool_use')
          assert.deepEqual(stale.map(({ cache_control: _cache, ...block }) => block), retained)
          const results = body.messages.flatMap(message => message.content)
            .filter(block => block.type === 'tool_result')
          assert.deepEqual(results.map(block => block.tool_use_id),
            assistants.slice(0, calls).flatMap(message => message.content)
              .filter(block => block.type === 'tool-call').map(block => block.id))
        }
        if (calls === 2) {
          assert.deepEqual(history[1].content.map(({ cache_control: _cache, ...block }) => block), nativeBlocks(assistants[1]))
        }
        const reply = assistants[calls++]
        assert.ok(reply, 'Recorded Anthropic responses exhausted')
        return responseFor(reply)
      } catch (error) {
        return Response.json({ error: { type: 'invalid_request_error', message: error.stack } }, { status: 400 })
      }
    }
    globalThis.fetch = fixtureFetch
    return () => {
      const observed = globalThis.fetch
      globalThis.fetch = originalFetch
      assert.equal(observed, fixtureFetch)
    }
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (calls !== 1 || checkpointCommitted) return next()
    assert.ok(original)
    assert.equal(original.sessionId, agent.session.id)
    const compactionId = 'anthropic-checkpoint-fixture'
    const content = [{ type: 'text', text: 'Earlier context was compacted for this snapshot.' }]
    agent.session.append('compaction/start', { compactionId, turn: 1 })
    agent.session.append('compaction/summary', {
      compactionId, summary: content, shadowedRange: { start: original.seq, end: original.seq },
      shadowedSeqs: [original.seq], shadowedTokenCount: 1, provider: 'gateway', model: assistants[0].source.model,
    })
    agent.session.append('user/message', {
      content, source: { kind: 'compact-checkpoint', compactionId }, role: 'user', id: randomUUID(),
    }, {
      surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq],
    })
    agent.session.append('compaction/end', { compactionId, turn: 1 })
    checkpointCommitted = true
    return next()
  })
}
