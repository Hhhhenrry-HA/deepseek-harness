/** Project completed deliveries outside Chat's process disclosures. */
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ConversationMatchHandler, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-tools/types'

/** Chat node kind and durable delivery metadata discriminator. */
export const DELIVERY = 'deliver-response'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Markdown body of a committed delivery. */
    [DELIVERY]: { readonly body: string }
  }
}

function deliveryResult(event: Parameters<ConversationMatchHandler>[0]) {
  if (event.type !== 'tool/result' || event.surfaceOp !== 'append' || event.data.message.isError === true) return undefined
  const meta = event.data.meta
  if (typeof meta !== 'object' || meta === null || !('kind' in meta) || meta.kind !== DELIVERY
    || !('body' in meta) || typeof meta.body !== 'string') return undefined
  return { body: meta.body, callId: String(event.data.message.source.callId) }
}

/** Render the committed body at its result position, even when the call is outside the loaded history. */
export const deliveryDefinition: ConversationNodeDefinitionInput<ReturnType<typeof deliveryResult>> = {
  kind: DELIVERY,
  target: 'chat',
  match: {
    'tool/result': (event) => {
      const result = deliveryResult(event)
      return result === undefined ? null : { id: result.callId, role: 'start' }
    },
  },
  start: (_context, match) => deliveryResult(match.event),
  update: context => context.state,
  buildViewNode: ({ start, state, key, id }) => {
    if (start === undefined || state === undefined) return null
    return {
      key, kind: DELIVERY, id, target: 'chat',
      anchorSeq: start.event.seq, location: start.location, visibility: 'visible', groupTree: 'turn',
      data: { body: state.body },
    } satisfies ChatNode<typeof DELIVERY>
  },
}
