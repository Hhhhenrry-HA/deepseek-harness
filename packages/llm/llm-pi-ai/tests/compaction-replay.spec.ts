import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { compactionReplayProjectionDefinition as projection } from '../src/compaction-replay.ts'
import type { CompactionReplayState } from '../src/compaction-replay.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function initial(): CompactionReplayState {
  return projection.init(Session.create(SessionId('empty')).header, SessionLogOffset(0))
}

function assistant(seq: number): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message', seq: SessionSeq(seq), time: 0, surfaceOp: 'append',
    data: {
      turn: 1, step: seq + 1, stream: [],
      message: createAssistantMessage({
        content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }],
        source: { provider: 'custom-claude-route', model: 'claude-sonnet-4-5' },
      }),
    },
  }
}

function prompt(seq: number): SessionEvent<'user/message'> {
  return {
    type: 'user/message', seq: SessionSeq(seq), time: 0, surfaceOp: 'append',
    data: createUserMessage({ content: [{ type: 'text', text: 'prompt' }], source: { kind: 'user' } }),
  }
}

function checkpoint(seq: number, replaced: number): SessionEvent<'user/message'> {
  return {
    type: 'user/message', seq: SessionSeq(seq), time: 0,
    surfaceOp: { op: 'replace', startSeq: SessionSeq(replaced), endSeq: SessionSeq(replaced) },
    sourceEventSeqs: [SessionSeq(replaced)],
    data: createUserMessage({
      content: [{ type: 'text', text: 'checkpoint' }],
      source: compactCheckpointSource(CompactionId(`compaction-${seq}`)),
    }),
  }
}

function fold(events: readonly SessionEvent[], state = initial()): CompactionReplayState {
  return events.reduce((current, event) => projection.apply(current, event), state)
}

describe('compaction thinking replay positions', () => {
  it('records assistant sequence zero without changing prior state', () => {
    const before = initial()
    const event = assistant(0)
    const after = projection.apply(before, event)
    expect(after.assistantSeqById[event.data.message.id]).toBe(0)
    expect(after.checkpointSeq).toBeNull()
    expect(before).toEqual({ assistantSeqById: {}, checkpointSeq: null })
    expect(projection.stateSchema.parse(JSON.parse(JSON.stringify(after)))).toEqual(after)
  })

  it('distinguishes retained pre-checkpoint assistants from new thinking', () => {
    const old = assistant(1)
    const replacement = checkpoint(2, 0)
    const fresh = assistant(3)
    const state = fold([prompt(0), old, replacement, fresh])
    expect(state.checkpointSeq).toBe(replacement.seq)
    expect(state.assistantSeqById[old.data.message.id]).toBeLessThan(replacement.seq)
    expect(state.assistantSeqById[fresh.data.message.id]).toBeGreaterThan(replacement.seq)
    expect(old.data.message.content[0]).toEqual({ type: 'reasoning', text: 'thinking' })
  })

  it('ignores an ordinary user replacement and a checkpoint marker appended without replacement', () => {
    const state = fold([assistant(0)])
    const ordinary = { ...prompt(1), surfaceOp: checkpoint(1, 0).surfaceOp, sourceEventSeqs: [SessionSeq(0)] }
    expect(projection.apply(state, ordinary)).toBe(state)
    const appended = { ...checkpoint(2, 0), surfaceOp: 'append' as const, sourceEventSeqs: undefined }
    // Append-origin messages do not perform compaction, even when their source carries its marker.
    const { sourceEventSeqs: _sourceEventSeqs, ...appendEvent } = appended
    expect(projection.apply(state, appendEvent)).toBe(state)
  })

  it('advances only for landed checkpoints across repeated and failed compactions', () => {
    const old = assistant(1)
    const first = checkpoint(2, 0)
    const between = assistant(3)
    const compactionId = CompactionId('failed-compaction')
    const state = fold([prompt(0), old, first, between])
    const failed: SessionEvent<'compaction/end'> = {
      type: 'compaction/end', seq: SessionSeq(4), time: 0,
      data: { compactionId, turn: 1, error: 'summary failed' },
    }
    expect(projection.apply(state, failed)).toBe(state)
    const second = checkpoint(5, 2)
    const fresh = assistant(6)
    const after = fold([second, fresh], state)
    expect(after.checkpointSeq).toBe(second.seq)
    expect(after.assistantSeqById[old.data.message.id]).toBeLessThan(second.seq)
    expect(after.assistantSeqById[between.data.message.id]).toBeLessThan(second.seq)
    expect(after.assistantSeqById[fresh.data.message.id]).toBeGreaterThan(second.seq)
    expect(state.checkpointSeq).toBe(first.seq)
  })

  it('reconstructs old logs and forks while preserving checkpoint history hidden by later replacement', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const old = assistant(1)
    const between = assistant(3)
    const fresh = assistant(5)
    const events = [prompt(0), old, checkpoint(2, 0), between, checkpoint(4, 2), fresh]
    const restored = ctx.sessions.create(SessionId('restored'), { seed: events })
    ctx.sessionProjections.register(projection)
    const expected = fold(events)
    expect(ctx.sessionProjections.stateOf(restored, projection.key)).toEqual(expected)
    const child = ctx.sessions.fork(restored)
    expect(ctx.sessionProjections.stateOf(child, projection.key)).toEqual(expected)
    const childAssistant = assistant(child.seq)
    child.append('assistant/message', childAssistant.data, { surfaceOp: 'append' })
    expect(ctx.sessionProjections.stateOf(child, projection.key)?.assistantSeqById[childAssistant.data.message.id])
      .toBe(childAssistant.seq)
    expect(ctx.sessionProjections.stateOf(restored, projection.key)).toEqual(expected)
  })

  it('retains a checkpoint when a later compaction close reports failure', () => {
    const replacement = checkpoint(2, 0)
    const state = fold([prompt(0), assistant(1), replacement])
    const failedClose: SessionEvent<'compaction/end'> = {
      type: 'compaction/end', seq: SessionSeq(3), time: 0,
      data: { compactionId: CompactionId('compaction-2'), turn: 1, error: 'close failed' },
    }
    expect(projection.apply(state, failedClose)).toBe(state)
    expect(state.checkpointSeq).toBe(replacement.seq)
  })
})
