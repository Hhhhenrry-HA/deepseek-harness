/** Same-session edit/resend and last-turn regeneration. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionRestartRequest, SessionPromptValue } from './types.ts'

/** Recover the input claimed by a turn that failed before message admission. */
function unadmittedRestart(events: readonly SessionEvent[], start: number, end: number): UserMessage | undefined {
  const pending: Record<'next-turn' | 'next-step', UserMessage[]> = { 'next-turn': [], 'next-step': [] }
  for (const event of events) {
    if (event.seq >= end) break
    if (event.type !== 'agent/inbox/spliced') continue
    const splice = event.data
    const removed = pending[splice.target].splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
    if (event.seq <= start || splice.outcome === 'canceled') continue
    const input = removed.find(message => message.source.kind === 'user' && 'restartSeq' in message.source)
    if (input !== undefined) return input
  }
  return undefined
}

/**
 * Queue one validated restart without changing history before model admission.
 * @param ctx - session query owner.
 * @param agent - resolved session writer.
 * @param request - original message or latest turn and replacement text.
 * @param signal - cancellation before durable admission.
 * @param source - caller identity recorded by the Remote entry.
 * @returns acknowledgement after durable inbox admission.
 */
export async function restartSession(
  ctx: Context, agent: Agent, request: SessionRestartRequest, signal: AbortSignal, source: Extract<MessageSource, { kind: 'user' }>,
): Promise<SessionPromptValue> {
  if (!Number.isSafeInteger(request.seq) || request.seq < 0) {
    throw new RemoteError('gateway/bad-request', 'seq must be a non-negative safe integer', {})
  }
  // This explicit history operation needs the original input, latest closed
  // turn and past admissions together, including requests accepted before resume.
  using observed = await ctx.sessionQuery.observeSession(agent.id, { signal, projectionMode: 'none' })
  signal.throwIfAborted()
  if (observed.events.some(event => event.type === 'agent/inbox/spliced'
    && event.data.inserted.some(message => message.source.kind === 'user'
      && 'rpcId' in message.source && message.source.rpcId === request.requestId))) return { accepted: true }
  if (agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) {
    throw new RemoteError('session/agent-busy', 'Wait for the current work to finish.', { reason: 'restart-busy' })
  }
  let task: Promise<SessionPromptValue>
  try {
    task = agent.runMaintenance(async (maintenanceSignal): Promise<SessionPromptValue> => {
      const admissionSignal = AbortSignal.any([signal, maintenanceSignal])
      admissionSignal.throwIfAborted()
      const { session } = agent
      using current = await ctx.sessionQuery.observeSession(agent.id, { signal: admissionSignal, projectionMode: 'none' })
      admissionSignal.throwIfAborted()
      if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) {
        throw new RemoteError('session/agent-busy', 'Wait for queued work to finish.', { reason: 'restart-busy' })
      }
      const target = current.events[request.seq]
      const latestEnd = current.events.findLast(event => event.type === 'turn/end')
      let input = target
      let unadmitted: UserMessage | undefined
      if (request.action.kind === 'retry') {
        if (target?.type !== 'turn/end' || target !== latestEnd) {
          throw new RemoteError('session/restart-unavailable', 'Only the latest completed turn can be regenerated.', {})
        }
        const start = current.events.findLast(event => event.type === 'turn/start' && event.data.turn === target.data.turn)
        input = current.events.find(event => event.seq > (start?.seq ?? target.seq)
        && event.seq < target.seq && event.type === 'user/message' && event.data.source.kind === 'user')
        if (input === undefined && start !== undefined) {
          unadmitted = unadmittedRestart(current.events, start.seq, target.seq)
          const source = unadmitted?.source
          const intent = source?.kind === 'user' && 'restartSeq' in source
            ? current.events[source.restartSeq] : undefined
          if (intent?.type === 'session/restart') input = current.events[intent.data.fromSeq]
        }
      }
      if (input?.type !== 'user/message' || input.data.source.kind !== 'user'
      || !session.surface.nodes.includes(input.seq)) {
        throw new RemoteError('session/restart-unavailable', 'This message is no longer in the active conversation.', {})
      }
      const content: UserMessage['content'] = request.action.kind === 'retry'
        ? [...(unadmitted ?? input.data).content]
        : [{ type: 'text', text: request.action.text }, ...input.data.content.filter(block => block.type !== 'text')]
      if (!content.some(block => block.type !== 'text' || block.text.trim().length > 0)) {
        throw new RemoteError('gateway/bad-request', 'The message must not be empty.', {})
      }
      const throughSeq = SessionSeq(current.cursor)
      const restart = session.append('session/restart', { fromSeq: input.seq, throughSeq })
      agent.followup(createUserMessage({
        content,
        source: { ...source, restartSeq: restart.seq,
          ...'clientTimeZone' in input.data.source ? { clientTimeZone: input.data.source.clientTimeZone } : {} },
      }))
      return { accepted: true }
    })
  } catch (error) {
    // runMaintenance throws synchronously only when another activity owns it.
    throw new RemoteError('session/agent-busy', 'Wait for the current work to finish.', { reason: 'restart-busy' }, { cause: error })
  }
  return await task
}

/**
 * Bind queued restart identities to atomic message-replacement admission.
 * @param ctx - Session Controller context carrying the query service.
 */
export function installRestartAdmission(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const message = decision.messages.find(candidate => candidate.source.kind === 'user'
      && 'restartSeq' in candidate.source)
    if (message === undefined || !('restartSeq' in message.source)) return decision
    const { target: record } = await ctx.sessionQuery.readEvent({ sessionId: agent.id, seq: message.source.restartSeq })
    if (record.type !== 'session/restart') throw new Error('Restart input has no durable request')
    if (!agent.session.surface.nodes.includes(record.data.fromSeq)) {
      throw new RemoteError('session/restart-unavailable', 'This message is no longer in the active conversation.', {})
    }
    return { ...decision, startsRequestSeries: true,
      replaceTail: { messageId: message.id, fromSeq: SessionSeq(record.data.fromSeq) } }
  })
}
