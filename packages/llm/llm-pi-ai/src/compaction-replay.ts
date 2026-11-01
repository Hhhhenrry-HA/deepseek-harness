/** Session-derived assistant replay invalidation after committed compaction checkpoints. */

import { z } from 'zod'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Assistant event positions and the newest committed compaction replacement. */
export interface CompactionReplayState {
  readonly assistantSeqById: Readonly<Record<MessageId, SessionSeq>>
  readonly checkpointSeq: SessionSeq | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Chronological assistant positions used to invalidate pre-checkpoint thinking replay. */
    piAiCompactionReplay: CompactionReplayState
  }
}

const eventSeqSchema = z.number().int().nonnegative().transform(SessionSeq)
const compactionReplayStateSchema: z.ZodType<CompactionReplayState> = z.object({
  assistantSeqById: z.record(z.string().transform(MessageId), eventSeqSchema),
  checkpointSeq: eventSeqSchema.nullable(),
}).strict()

/** Host-only fold of assistant identities and committed checkpoint replacements, including inherited history. */
export const compactionReplayProjectionDefinition: ProjectionDefinition<'piAiCompactionReplay'> = {
  key: 'piAiCompactionReplay',
  stateVersion: 1,
  stateSchema: compactionReplayStateSchema,
  init: () => ({ assistantSeqById: {}, checkpointSeq: null }),
  apply: (state, event) => {
    if (event.type === 'assistant/message') {
      return {
        ...state,
        assistantSeqById: { ...state.assistantSeqById, [event.data.message.id]: event.seq },
      }
    }
    if (event.type === 'user/message'
      && event.surfaceOp !== 'append'
      && isCompactCheckpointSource(event.data.source)) {
      return { ...state, checkpointSeq: event.seq }
    }
    return state
  },
}
