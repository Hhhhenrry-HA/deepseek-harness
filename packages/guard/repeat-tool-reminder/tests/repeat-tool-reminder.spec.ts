import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as RepeatToolGuard from '@deepseek-ai/dsh-repeat-tool-reminder'
import type { Config } from '@deepseek-ai/dsh-repeat-tool-reminder'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test': { kind: 'test' } & ContextFormed
  }
}

const testToolSignal = new AbortController().signal

/**
 * Behavior suite for the repeat-tool-call guard: chain semantics (identical /
 * different-tracked / untracked-transparent / per-agent / resets), threshold
 * escalation incl. the `thresholds[0]` gentle-text rule, canonicalization,
 * fold-onto-downstream-decision, and fail-loud config validation — all driven
 * through a real agent loop against a scripted mock adapter (no network).
 */

/** Boot the core spine + the guard; the caller registers adapters and extra listeners. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(RepeatToolGuard, config)
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  ctx.tools.register(defineContentToolFixture({ name: 'other', description: 'o', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

/** Every injected-context user message in the agent's log, flattened to joined text + source for terse assertions. */
function reminders(agent: Agent): { text: string; source: unknown }[] {
  return agent.session.snapshotEvents()
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind !== 'user')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

// The reminder is a `notice`-form context; its summary names the repeated
// call so a reader sees it without expanding the row.
const guardSource = (tool: string, count: number) => ({
  kind: 'repeat-tool-reminder',
  form: 'notice',
  summary: `${tool} × ${count}`,
})

describe('threshold escalation', () => {
  it('reminds gently at the first default threshold (3) and in detail at the second (5)', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      ...Array.from({ length: 5 }, (_, i) => toolCallResponse(`c${i}`, 'probe', { q: 'same' })),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
    expect(found[0]!.source).toEqual(guardSource('probe', 3))
    expect(found[1]!.text).toContain('consecutive_calls: 5')
    expect(found[1]!.text).toContain('- tool: probe')
    expect(found[1]!.text).toContain('{"q":"same"}')
    expect(found[1]!.source).toEqual(guardSource('probe', 5))
  })

  it('keys the gentle text to thresholds[0], not the literal 3', async () => {
    const ctx = await harness({ thresholds: [4, 2] }) // unsorted on purpose: normalized ascending
    const adapter = new MockAdapter([
      ...Array.from({ length: 4 }, (_, i) => toolCallResponse(`c${i}`, 'probe', {})),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2)
    expect(found[0]!.text).toContain('repeating the exact same tool call') // gentle at 2
    expect(found[1]!.text).toContain('consecutive_calls: 4') // detailed at 4
  })
})

describe('chain semantics', () => {
  it('caps the detailed reminder arguments at argumentsPreviewChars (detection still keys on the full string)', async () => {
    const ctx = await harness({ thresholds: [2, 3], argumentsPreviewChars: 24 })
    const bigPayload = 'x'.repeat(400)
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { body: bigPayload }),
      toolCallResponse('c2', 'probe', { body: bigPayload }),
      toolCallResponse('c3', 'probe', { body: bigPayload }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2) // gentle at 2, detailed at 3 — full-key matching survived the cap
    const detailed = found[1]!.text
    expect(detailed).toContain('- arguments: {"body":"xxxxxxxxxxxxxx') // 24-char head
    expect(detailed).toContain('… (+387 more chars)')
    expect(detailed).not.toContain(bigPayload)
  })

  it('a different tracked call resets the chain', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      toolCallResponse('c3', 'other', {}), // tracked, different → reset
      toolCallResponse('c4', 'probe', { q: 1 }),
      toolCallResponse('c5', 'probe', { q: 1 }),
      toolCallResponse('c6', 'probe', { q: 1 }), // 3rd consecutive AFTER the reset
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(1)
  })

  it('excluded calls are transparent: they neither count nor reset', async () => {
    const ctx = await harness({ exclude: ['other'] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'other', {}), // excluded → invisible to the chain
      toolCallResponse('c3', 'probe', { q: 1 }),
      toolCallResponse('c4', 'other', {}),
      toolCallResponse('c5', 'probe', { q: 1 }), // 3rd consecutive probe
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
  })

  it('include patterns track only matching tools (wildcard star)', async () => {
    const ctx = await harness({ include: ['pro*'] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'other', {}),
      toolCallResponse('c2', 'other', {}),
      toolCallResponse('c3', 'other', {}), // 3 identical, but untracked
      toolCallResponse('c4', 'probe', {}),
      toolCallResponse('c5', 'probe', {}),
      toolCallResponse('c6', 'probe', {}), // 3 identical, tracked
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
  })

  it('escapes regex metacharacters in patterns (a dot matches only a literal dot)', async () => {
    const ctx = await harness({ exclude: ['pr.be'] }) // would match 'probe' as a regex; must not as a wildcard
    const adapter = new MockAdapter([
      ...Array.from({ length: 3 }, (_, i) => toolCallResponse(`c${i}`, 'probe', {})),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(1) // probe was NOT excluded
  })

  it('canonicalization ignores property order, deeply', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { a: 1, nested: { x: [1, 2], y: null } }),
      toolCallResponse('c2', 'probe', { nested: { y: null, x: [1, 2] }, a: 1 }),
      toolCallResponse('c3', 'probe', { a: 1, nested: { x: [1, 2], y: null } }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(1) // all three canonicalize identically
  })

  it('keys chains per agent: one agent repeating never trips another', async () => {
    const ctx = await harness()
    ctx.llm.registerAdapter(['mock-a'], new MockAdapter([
      toolCallResponse('a1', 'probe', { q: 1 }),
      toolCallResponse('a2', 'probe', { q: 1 }),
      textResponse('done'),
    ]))
    ctx.llm.registerAdapter(['mock-b'], new MockAdapter([
      toolCallResponse('b1', 'probe', { q: 1 }),
      toolCallResponse('b2', 'probe', { q: 1 }),
      toolCallResponse('b3', 'probe', { q: 1 }),
      textResponse('done'),
    ]))
    const agentA = await ctx.agentLoop.create(SessionId('a'), { provider: 'mock-a', model: 'model-a' })
    const agentB = await ctx.agentLoop.create(SessionId('b'), { provider: 'mock-b', model: 'model-b' })
    agentA.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    agentB.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await Promise.all([waitForIdle(ctx, agentA), waitForIdle(ctx, agentB)])

    expect(reminders(agentA)).toHaveLength(0) // 2 repeats < 3, despite B's 3 in the same registry
    expect(reminders(agentB)).toHaveLength(1)
  })

  it('a new user prompt resets the chain', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('turn one done'),
      toolCallResponse('c3', 'probe', { q: 1 }), // without the reset this would be the 3rd
      textResponse('turn two done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(0)
  })

  it('drops an agent chain on disposal', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      textResponse('done'),
      toolCallResponse('c2', 'probe', { q: 1 }), // same id, fresh agent: count 1, not 2
      textResponse('done'),
    ]))
    // Loop agents are torn down by disposing the scope that created them
    // (the loop.spec pattern): a child plugin fiber owns `first`.
    let first!: Agent
    const fiber = await ctx.plugin(Object.assign(async (inner: Context) => {
      first = await inner.agentLoop.create(SessionId('reused'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))
    first.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, first)
    await fiber.dispose()
    await first.whenIdle()

    const second = await ctx.agentLoop.create(SessionId('reused'), { provider: 'mock', model: 'mock' })
    second.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, second)

    expect(reminders(second)).toHaveLength(0)
  })

  it('counts denied calls: hammering a denied tool still draws the reminder', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.on('tools/pre-execute', async () => ({ kind: 'deny' as const, reason: 'sealed' }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(0)
    const results = agent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results[1]!.data.message.content.slice(0, -1)).toEqual(results[0]!.data.message.content)
    expect(results[1]!.data.message.content).toHaveLength(results[0]!.data.message.content.length + 1)
  })

  it('ignores direct executes with no agent (they neither crash nor advance any chain)', async () => {
    const ctx = await harness({ thresholds: [2] })
    const direct = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('d1'), name: 'probe', arguments: { q: 1 } })
    expect(direct.isError).toBe(false)

    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }), // if the direct call had counted, this would be #2
      textResponse('done'),
    ]))
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(0)
  })
})

describe('fold onto the downstream decision', () => {
  it('folds the reminder onto a downstream block and keeps its feedback', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.on('tools/post-execute', async () => ({
      kind: 'block' as const,
      feedback: [{ type: 'text' as const, text: 'nope' }],
      additionalContexts: [createUserMessage({
        content: [{ type: 'text' as const, text: 'downstream-ctx' }], source: { kind: 'test' as const },
      })],
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2)
    expect(found[0]).toEqual({ text: 'downstream-ctx', source: { kind: 'test' } })
    expect(found[1]).toEqual(found[0])
    // Preserve the original policy feedback; only the repeated error gains advice.
    const results = agent.session.snapshotEvents().filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    expect(results.every(r => r.data.message.isError)).toBe(true)
    expect(results[0]!.data.message.content).toEqual([{ type: 'text', text: 'nope' }])
    expect(results[1]!.data.message.content.slice(0, -1)).toEqual(results[0]!.data.message.content)
    expect(results[1]!.data.message.content).toHaveLength(2)
  })

  it('preserves a downstream canonical value replacement while folding', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.on('tools/post-execute', async () => ({
      kind: 'accept' as const,
      value: [{ type: 'text' as const, text: 'replaced' }],
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
    const results = agent.session.snapshotEvents().filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    expect(results[1]!.data.message.content).toEqual([{ type: 'text', text: 'replaced' }])
  })
})

describe('inline repeated-failure advice', () => {
  async function failingHarness(config: Config = {}) {
    const ctx = await harness(config)
    const fixture: { error: HarnessError | undefined } = { error: new HarnessError('failure-A', 'FAILURE_A') }
    ctx.tools.register(defineContentToolFixture({
      name: 'failing', description: 'scripted failure', parameters: {},
      async execute() {
        if (fixture.error) throw fixture.error
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    const agent = await ctx.agentLoop.create(SessionId('failure-agent'), { provider: 'mock', model: 'mock' })
    let calls = 0
    const call = (args: unknown = {}, name = 'failing', caller: Agent = agent) => ctx.tools.execute({
      signal: testToolSignal, callId: ToolCallId(`failure-${++calls}`), name, arguments: args, agent: caller,
    })
    return { ctx, agent, fixture, call }
  }

  it('appends one warning from the second identical failure, preserving the error and avoiding duplicate context', async () => {
    const { ctx, call } = await failingHarness()
    try {
      const first = await call({ a: 1, b: 2 })
      const second = await call({ b: 2, a: 1 })
      const third = await call({ a: 1, b: 2 })
      expect(first.isError).toBe(true)
      expect(second.isError).toBe(true)
      expect(second.error).toEqual(first.error)
      expect(second.content.slice(0, -1)).toEqual(first.content)
      expect(second.content).toHaveLength(first.content.length + 1)
      expect(second.content.at(-1)?.type).toBe('text')
      expect(third.content).toEqual(second.content)
      expect(second.additionalContexts).toBeUndefined()
      expect(third.additionalContexts).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })

  it.each([false, true])('keeps canonical blocked failures separate from rendered advice (nested: %s)', async (nested) => {
    const { ctx, agent } = await failingHarness()
    try {
      const feedback = [{ type: 'text' as const, text: 'canonical policy failure' }]
      const content = [{ type: 'text' as const, text: 'rendered policy feedback' }]
      ctx.on('tools/post-execute', (exec, _result, next) => exec.name === 'probe'
        ? Promise.resolve({
          kind: 'block' as const, feedback, content,
          additionalContexts: [createUserMessage({
            content: [{ type: 'text', text: 'policy context' }], source: { kind: 'test' },
          })],
        })
        : next())
      const results: ToolExecutionResult[] = []
      ctx.tools.register(defineContentToolFixture({
        name: 'nested-probe', description: 'Dispatch blocked subcalls.', parameters: {},
        async execute(_args, exec) {
          for (let index = 0; index < 3; index++) {
            results.push(await ctx.tools.execute({
              signal: exec.signal, agent, parent: exec.token, rootCallId: exec.rootCallId,
              callId: ToolCallId(`nested-block-${index}`), name: 'probe', arguments: {},
            }))
          }
          return []
        },
      }))
      if (nested) {
        await ctx.tools.execute({
          signal: testToolSignal, agent, callId: ToolCallId('parent-block'), name: 'nested-probe', arguments: {},
        })
      } else {
        for (let index = 0; index < 3; index++) {
          results.push(await ctx.tools.execute({
            signal: testToolSignal, agent, callId: ToolCallId(`direct-block-${index}`), name: 'probe', arguments: {},
          }))
        }
      }
      expect(results).toHaveLength(3)
      expect(results.every(result => result.isError)).toBe(true)
      expect(results.map(result => result.error)).toEqual(Array.from({ length: 3 }, () => ({ message: feedback[0]!.text })))
      expect(results[0]!.content).toEqual(content)
      expect(results[1]!.content.slice(0, -1)).toEqual(content)
      expect(results[1]!.content).toHaveLength(content.length + 1)
      expect(results[2]!.content).toEqual(results[1]!.content)
      expect(results.map(result => result.additionalContexts?.map(context => context.source.kind)))
        .toEqual([['test'], ['test'], nested ? ['repeat-tool-reminder', 'test'] : ['test']])
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['arguments', 'message', 'code', 'success'] as const)('starts a fresh failure chain after a change in %s', async (change) => {
    const { ctx, fixture, call } = await failingHarness({ thresholds: [100] })
    try {
      await call()
      let args = {}
      if (change === 'arguments') args = { changed: true }
      if (change === 'message') fixture.error = new HarnessError('failure-B', 'FAILURE_A')
      if (change === 'code') fixture.error = new HarnessError('failure-A', 'FAILURE_B')
      if (change === 'success') {
        const error = fixture.error
        fixture.error = undefined
        const success = await call()
        expect(success.isError).toBe(false)
        expect(success.content).toHaveLength(1)
        fixture.error = error
      }
      const fresh = await call(args)
      const repeated = await call(args)
      expect(fresh.content).toHaveLength(1)
      expect(repeated.content.slice(0, -1)).toEqual(fresh.content)
      expect(repeated.content).toHaveLength(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps excluded calls transparent and failure counts separate between agents', async () => {
    const { ctx, call } = await failingHarness({ exclude: ['other'] })
    try {
      const first = await call()
      await call({}, 'other')
      const second = await call()
      expect(second.content).toHaveLength(first.content.length + 1)
      const otherAgent = await ctx.agentLoop.create(SessionId('other-failure-agent'), { provider: 'mock', model: 'mock' })
      const separate = await call({}, 'failing', otherAgent)
      expect(separate.content).toEqual(first.content)
      const direct = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('direct-failure'), name: 'failing', arguments: {} })
      expect(direct.content).toEqual(first.content)
    } finally { await ctx.fiber.dispose() }
  })

  it('resets failure counts on a new user message and records the inline warning in the model-visible result', async () => {
    const ctx = await harness()
    try {
      ctx.tools.register(defineContentToolFixture({ name: 'failing', description: 'f', parameters: {}, async execute() {
        throw new HarnessError('fixture failure', 'FIXTURE_FAILURE')
      } }))
      const adapter = new MockAdapter([
        toolCallResponse('f1', 'failing', {}), toolCallResponse('f2', 'failing', {}), textResponse('done'),
        toolCallResponse('f3', 'failing', {}), textResponse('done'),
      ])
      ctx.llm.registerAdapter(['mock'], adapter)
      const agent = await ctx.agentLoop.create(SessionId('failure-loop'), { provider: 'mock', model: 'mock' })
      for (const text of ['first request', 'new request']) {
        const idle = waitForIdle(ctx, agent)
        agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
        await idle
      }
      const results = agent.session.snapshotEvents()
        .filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
        .map(event => event.data.message)
      expect(results).toHaveLength(3)
      expect(results.map(result => result.isError)).toEqual([true, true, true])
      expect(results[1]!.content.slice(0, -1)).toEqual(results[0]!.content)
      expect(results[1]!.content).toHaveLength(results[0]!.content.length + 1)
      expect(results[2]!.content).toEqual(results[0]!.content)
      const visible = adapter.requests[2]!.messages.filter(message => message.role === 'tool')
      expect(visible.at(-1)?.content).toEqual(results[1]!.content)
      expect(reminders(agent)).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })
})

describe('config validation fails loud', () => {
  async function spine(): Promise<Context> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    return ctx
  }

  it('rejects an empty thresholds list', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [] })).rejects.toThrow(/must not be empty/)
  })

  it('rejects a threshold below 2', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [1, 3] })).rejects.toThrow(/integer >= 2/)
  })

  it('rejects a non-integer threshold', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [2.5] })).rejects.toThrow(/integer >= 2/)
  })

  it('rejects duplicate thresholds', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [3, 3] })).rejects.toThrow(/duplicates/)
  })

  it('rejects a non-positive or fractional argumentsPreviewChars', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { argumentsPreviewChars: 0 })).rejects.toThrow(/argumentsPreviewChars/)
    const ctx2 = await spine()
    await expect(ctx2.plugin(RepeatToolGuard, { argumentsPreviewChars: 12.5 })).rejects.toThrow(/argumentsPreviewChars/)
  })
})
