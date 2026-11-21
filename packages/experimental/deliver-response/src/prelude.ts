/** Logged prelude progress for each active Session turn. */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { CHECKLIST_SOURCE, PRELUDE } from './protocol.ts'

const schema = z.object({
  checklistId: z.string(),
  stage: z.enum(['read', 'approval', 'done']),
}).nullable()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The pending prelude or its settlement in the current open turn. */
    'deliver-response': z.infer<typeof schema>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Instructions remain ordinary recorded user-role content without this plugin.
     * @persistenceAttribution
     */
    'plugin:deliver-response': { kind: typeof CHECKLIST_SOURCE; form: 'instructions' }
  }
}

type PendingStage = keyof typeof PRELUDE

function preludeCallId(checklistId: string, stage: PendingStage): ToolCallId {
  return ToolCallId(`${checklistId}-${PRELUDE[stage].name}`)
}

/** Recover progress from accepted checklist and settled tool results, not from stream attempts. */
export const preludeProjection: ProjectionDefinition<'deliver-response'> = {
  key: 'deliver-response',
  stateVersion: 1,
  stateSchema: schema,
  init: () => null,
  apply(state, event) {
    if (event.type === 'turn/start' || event.type === 'turn/end') return null
    if (event.type === 'user/message' && event.data.source.kind === CHECKLIST_SOURCE && state === null) {
      return { checklistId: event.data.id, stage: 'read' }
    }
    if (event.type !== 'tool/result' || state === null || state.stage === 'done') return state
    if (event.data.message.toolCallId !== preludeCallId(state.checklistId, state.stage)) return state
    return { ...state, stage: state.stage === 'read' && !event.data.message.isError ? 'approval' : 'done' }
  },
}

/**
 * Produce an assistant stream for one prelude step. The loop executes the call and commits its result.
 * @param checklistId - identity of the admitted checklist for this turn.
 * @param stage - the unsettled prelude step.
 * @returns a stream without provider usage; it makes no model request.
 */
// oxlint-disable-next-line typescript/require-await -- The model stream consumes an async iterator; the prelude has no I/O.
export async function* streamPrelude(checklistId: string, stage: PendingStage): AsyncGenerator<StreamChunk> {
  const { name, text } = PRELUDE[stage]
  const id = preludeCallId(checklistId, stage)
  const toolCall = { type: 'tool-call' as const, id, name, arguments: '{}' }
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'block-start', index: 1, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 1, id, name, argumentsDelta: toolCall.arguments }
  yield { type: 'block-end', index: 1, block: toolCall }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
