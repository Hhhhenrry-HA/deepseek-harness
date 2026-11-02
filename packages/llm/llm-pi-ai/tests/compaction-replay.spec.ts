import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
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

function toolResult(seq: number): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result', seq: SessionSeq(seq), time: 0, surfaceOp: 'append',
    data: {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('saved-tool'), content: [{ type: 'text', text: 'saved result' }], isError: false,
      }),
    },
  }
}

function rewriteResult(seq: number, original: SessionEvent<'tool/result'>): SessionEvent<'tool/result'> {
  return {
    ...original, seq: SessionSeq(seq),
    surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq },
    sourceEventSeqs: [original.seq],
    data: { ...original.data, message: { ...original.data.message, content: [{ type: 'text', text: 'pruned result' }] } },
  }
}

function fold(events: readonly SessionEvent[], state = initial()): CompactionReplayState {
  return events.reduce((current, event) => projection.apply(current, event), state)
}

describe('thinking replay across history replacements', () => {
  it('records assistant sequence zero without changing prior state', () => {
    const before = initial()
    const event = assistant(0)
    const after = projection.apply(before, event)
    expect(after.assistantSeqById[event.data.message.id]).toBe(0)
    expect(after.replacementSeq).toBeNull()
    expect(before).toEqual({ assistantSeqById: {}, replacementSeq: null })
    expect(projection.stateSchema.parse(JSON.parse(JSON.stringify(after)))).toEqual(after)
  })

  it('distinguishes retained pre-checkpoint assistants from new thinking', () => {
    const old = assistant(1)
    const replacement = checkpoint(2, 0)
    const fresh = assistant(3)
    const state = fold([prompt(0), old, replacement, fresh])
    expect(state.replacementSeq).toBe(replacement.seq)
    expect(state.assistantSeqById[old.data.message.id]).toBeLessThan(replacement.seq)
    expect(state.assistantSeqById[fresh.data.message.id]).toBeGreaterThan(replacement.seq)
    expect(old.data.message.content[0]).toEqual({ type: 'reasoning', text: 'thinking' })
  })

  it('invalidates old thinking for ordinary user and system replacements', () => {
    const state = fold([assistant(0)])
    const ordinary = { ...prompt(1), surfaceOp: checkpoint(1, 0).surfaceOp, sourceEventSeqs: [SessionSeq(0)] }
    expect(projection.apply(state, ordinary).replacementSeq).toBe(ordinary.seq)
    const system: SessionEvent<'system/message'> = {
      type: 'system/message', seq: SessionSeq(2), time: 0,
      surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(0) },
      sourceEventSeqs: [SessionSeq(0)],
      data: { turn: 1, step: 1, message: createSystemMessage('new system prompt') },
    }
    expect(projection.apply(state, system).replacementSeq).toBe(system.seq)
    expect(state.replacementSeq).toBeNull()
  })

  it('ignores append-only history and accounting events before a committed rewrite', () => {
    const state = fold([assistant(0)])
    const appended = { ...checkpoint(2, 0), surfaceOp: 'append' as const, sourceEventSeqs: undefined }
    const { sourceEventSeqs: _sourceEventSeqs, ...appendEvent } = appended
    expect(projection.apply(state, appendEvent)).toBe(state)
    expect(projection.apply(state, prompt(1))).toBe(state)
    expect(projection.apply(state, toolResult(1))).toBe(state)
    const prune: SessionEvent<'compaction/prune'> = {
      type: 'compaction/prune', seq: SessionSeq(2), time: 0,
      data: {
        shadowedRange: { start: SessionSeq(1), end: SessionSeq(1) },
        shadowedSeqs: [SessionSeq(1)], shadowedTokenCount: 10,
      },
    }
    expect(projection.apply(state, prune)).toBe(state)
  })

  it('invalidates thinking at each committed tool-result rewrite and retains later thinking', () => {
    const old = assistant(1)
    const result = toolResult(2)
    const between = assistant(3)
    const rewrite = rewriteResult(4, result)
    const fresh = assistant(5)
    const state = fold([prompt(0), old, result, between])
    const after = fold([rewrite, fresh], state)
    expect(after.replacementSeq).toBe(rewrite.seq)
    expect(after.assistantSeqById[old.data.message.id]).toBeLessThan(rewrite.seq)
    expect(after.assistantSeqById[between.data.message.id]).toBeLessThan(rewrite.seq)
    expect(after.assistantSeqById[fresh.data.message.id]).toBeGreaterThan(rewrite.seq)
    expect(state.replacementSeq).toBeNull()
    const again = rewriteResult(6, rewrite)
    expect(projection.apply(after, again).replacementSeq).toBe(again.seq)
    expect(projection.stateSchema.parse(JSON.parse(JSON.stringify(after)))).toEqual(after)
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
    expect(after.replacementSeq).toBe(second.seq)
    expect(after.assistantSeqById[old.data.message.id]).toBeLessThan(second.seq)
    expect(after.assistantSeqById[between.data.message.id]).toBeLessThan(second.seq)
    expect(after.assistantSeqById[fresh.data.message.id]).toBeGreaterThan(second.seq)
    expect(state.replacementSeq).toBe(first.seq)
  })

  it.each(['checkpoint', 'tool-result rewrite'] as const)('reconstructs %s history after restore and fork', async (kind) => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const old = assistant(1)
    const between = assistant(3)
    const fresh = assistant(5)
    const result = toolResult(2)
    const events = kind === 'checkpoint'
      ? [prompt(0), old, checkpoint(2, 0), between, checkpoint(4, 2), fresh]
      : [prompt(0), old, result, between, rewriteResult(4, result), fresh]
    const restored = ctx.sessions.create(SessionId('restored'), { seed: events })
    ctx.sessionProjections.register(projection)
    const expected = fold(events)
    const recovered = ctx.sessionProjections.restore({
      [projection.key]: {
        ver: 1, seq: SessionSeq(5),
        val: { assistantSeqById: expected.assistantSeqById, checkpointSeq: kind === 'checkpoint' ? 4 : null },
      },
    }, events, SessionLogOffset(0), restored.header, SessionLogOffset(0))
    expect(recovered.checkpoint[projection.key]).toEqual({ ver: 2, seq: 5, val: expected })
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
    expect(state.replacementSeq).toBe(replacement.seq)
  })
})
