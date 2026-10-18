/** Restart contracts: wrong input/context or duplicate admission corrupts a chat and can repeat paid work. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRestartRequest, SessionRequestId } from '../src/types.ts'
import { createSessionTestController } from './test-remote.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

class Adapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  fail = false
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    if (this.fail) throw new Error('test provider rejection')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `reply-${this.requests.length}` } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  const adapter = new Adapter()
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: process.cwd(),
  })
  const agent = await loop.create(SessionId('restart-test'), { provider: 'mock', model: 'mock' })
  const send = async (text: string) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    await agent.whenIdle()
  }
  let serial = 0
  const restart = (seq: number, action: SessionRestartRequest['action'], id = `restart-${++serial}`) =>
    controller.restart({ sessionId: agent.id, requestId: id as SessionRequestId, seq, action }, new AbortController().signal)
  const userSeq = () => agent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')!.seq
  const endSeq = () => agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')!.seq
  return { ctx, agent, adapter, send, restart, userSeq, endSeq }
}

describe('same-session restart', () => {
  it('retains attachment identities and admits fresh pre-step input after the replacement', async () => {
    const { ctx, agent, send, restart, userSeq, adapter } = await harness()
    await send('original')
    ctx.on('agent/pre-step', async (_event, next) => {
      const decision = await next()
      return decision.kind === 'enter' ? { ...decision, messages: [...decision.messages,
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'fresh supplemental input' }] }),
      ] } : decision
    })
    await restart(userSeq(), { kind: 'edit', text: 'edited' })
    await agent.whenIdle()
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('fresh supplemental input')
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).not.toContain('original')
    const attachment = { attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`), name: 'notes.txt', bytes: 10 }
    const input = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'read attachment' }, { type: 'file', attachment }],
    }), { surfaceOp: 'append' })
    await restart(input.seq, { kind: 'edit', text: '' })
    await agent.whenIdle()
    const admitted = agent.session.snapshotEvents().findLast(event => event.type === 'user/message'
      && event.data.source.kind === 'user' && 'restartSeq' in event.data.source)
    expect(admitted?.type === 'user/message' ? admitted.data.content : null)
      .toEqual([{ type: 'text', text: '' }, { type: 'file', attachment }])
  })

  it('concurrent submissions cannot admit the same paid work twice', async () => {
    const { agent, adapter, send, restart, endSeq } = await harness()
    await send('repeat safely')
    const end = endSeq()
    const outcomes = await Promise.allSettled([
      restart(end, { kind: 'retry' }, 'concurrent'), restart(end, { kind: 'retry' }, 'concurrent'),
    ])
    expect(outcomes.some(outcome => outcome.status === 'fulfilled')).toBe(true)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
  })

  it('editing the latest input preserves earlier exchanges and replay derives the same branch', async () => {
    const { agent, adapter, send, restart, userSeq } = await harness()
    await send('original')
    await send('later prompt')
    await restart(userSeq(), { kind: 'edit', text: 'edited' })
    await agent.whenIdle()
    const payload = JSON.stringify(adapter.requests.at(-1)?.messages)
    expect(payload).toContain('edited')
    expect(payload).toContain('original')
    expect(payload).not.toContain('later prompt')
    expect(payload).toContain('reply-1')
    expect(payload).not.toContain('reply-2')
    expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
      && JSON.stringify(event.data.content).includes('original'))).toBe(true)
    const restored = Session.create(agent.id, agent.session.snapshotEvents(), agent.session.header)
    expect(restored.deriveMessages()).toEqual(agent.session.deriveMessages())
    expect(agent.id).toBe('restart-test')
  })

  it('regenerates the last closed turn without resending the old answer; repeated request ids do not run twice', async () => {
    const { agent, adapter, send, restart, endSeq } = await harness()
    await send('same prompt')
    const end = endSeq()
    await restart(end, { kind: 'retry' }, 'same-id')
    await agent.whenIdle()
    await restart(end, { kind: 'retry' }, 'same-id')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('same prompt')
    expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain('reply-1')
  })

  it('rejects old tails, retired inputs, queued work and malformed coordinates without recording a restart', async () => {
    const { agent, adapter, send, restart, userSeq, endSeq } = await harness()
    await send('first')
    const oldEnd = endSeq()
    const oldUser = userSeq()
    await send('second')
    const before = agent.session.snapshotEvents()
    const messages = agent.session.deriveMessages()
    await expect(restart(oldEnd, { kind: 'retry' })).rejects.toMatchObject({ code: 'session/restart-unavailable' })
    await expect(restart(oldUser, { kind: 'edit', text: 'replacement' })).rejects.toMatchObject({ code: 'session/restart-unavailable' })
    await expect(restart(-1, { kind: 'retry' })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(agent.session.snapshotEvents()).toEqual(before)
    expect(agent.session.deriveMessages()).toEqual(messages)
    expect(adapter.requests).toHaveLength(2)
    const latestUser = userSeq()
    await restart(latestUser, { kind: 'edit', text: 'replacement' })
    await agent.whenIdle()
    await expect(restart(latestUser, { kind: 'edit', text: 'again' })).rejects.toMatchObject({ code: 'session/restart-unavailable' })
    agent.inject(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'pending' }] }))
    const count = agent.session.snapshotEvents().length
    await expect(restart(endSeq(), { kind: 'retry' })).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect(agent.session.snapshotEvents()).toHaveLength(count)
  })

  it('retries a failed provider response in the same conversation', async () => {
    const { agent, adapter, send, restart, endSeq } = await harness()
    adapter.fail = true
    await send('recover')
    adapter.fail = false
    await restart(endSeq(), { kind: 'retry' })
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('recover')
    expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain('test provider rejection')
  })

  it('request preparation failure retains the old surface and retry recovers the edited input', async () => {
    const { agent, adapter, send, restart, userSeq, endSeq } = await harness()
    await send('retain me')
    const before = agent.session.deriveMessages()
    const resolveModel = vi.spyOn(adapter, 'resolveModel').mockRejectedValue(new Error('prepare rejected'))
    await restart(userSeq(), { kind: 'edit', text: 'not admitted' })
    await agent.whenIdle()
    expect(agent.session.deriveMessages()).toEqual(before)
    expect(adapter.requests).toHaveLength(1)
    resolveModel.mockRestore()
    await restart(endSeq(), { kind: 'retry' })
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('not admitted')
    expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain('retain me')
  })
})
