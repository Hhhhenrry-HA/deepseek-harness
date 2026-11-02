/** Session-derived assistant replay invalidation after committed history replacements. */

import { z } from 'zod'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Assistant event positions and the newest committed history replacement. */
export interface CompactionReplayState {
  readonly assistantSeqById: Readonly<Record<MessageId, SessionSeq>>
  readonly replacementSeq: SessionSeq | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Chronological assistant positions used to invalidate pre-replacement thinking replay. */
    piAiCompactionReplay: CompactionReplayState
  }
}

const eventSeqSchema = z.number().int().nonnegative().transform(SessionSeq)
const compactionReplayStateSchema: z.ZodType<CompactionReplayState> = z.object({
  assistantSeqById: z.record(z.string().transform(MessageId), eventSeqSchema),
  replacementSeq: eventSeqSchema.nullable(),
}).strict()

/** Host-only fold of assistant identities and committed history replacements, including inherited history. */
export const compactionReplayProjectionDefinition: ProjectionDefinition<'piAiCompactionReplay'> = {
  key: 'piAiCompactionReplay',
  stateVersion: 2,
  stateSchema: compactionReplayStateSchema,
  init: () => ({ assistantSeqById: {}, replacementSeq: null }),
  apply: (state, event) => {
    const next = isReplacementSurfaceEvent(event) ? { ...state, replacementSeq: event.seq } : state
    if (event.type === 'assistant/message') {
      return {
        ...next,
        assistantSeqById: { ...next.assistantSeqById, [event.data.message.id]: event.seq },
      }
    }
    return next
  },
}
