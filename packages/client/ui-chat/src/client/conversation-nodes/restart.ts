/** Active-chat branch projection; the immutable trajectory remains available. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition, ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type { ChatConversationViewNode, ChatNode } from '../contract/chat-nodes.ts'
import { isVisibleChatNode } from '../contract/chat-visibility.ts'
import { chatNode } from './common.ts'

interface RestartState {
  readonly fromSeq: number
  readonly throughSeq: number
  readonly admitted: boolean
}

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Hidden marker that retires a branch only after replacement input admission. */
    'restarted-history': RestartState
  }
}

/** Correlate durable restart intent with its admitted input, including paged replay. */
export const restartDefinition: ConversationNodeDefinition<RestartState> = {
  kind: 'restarted-history',
  target: 'chat',
  match(event) {
    if (event.type === 'session/restart') return { id: String(event.seq), role: 'start' }
    if (event.type !== 'user/message') return null
    const source = event.data.source
    return source.kind === 'user' && 'restartSeq' in source
      ? { id: String(source.restartSeq), role: 'update' }
      : null
  },
  start(_context, match) {
    if (match.event.type !== 'session/restart') throw new Error('Restart start requires session/restart')
    return { ...match.event.data, admitted: false }
  },
  update: context => ({ ...context.state, admitted: true }),
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'restarted-history', Number(context.id), context.state, { visibility: 'hidden' })
  },
}

/**
 * Register restart correlation without changing raw history or other targets.
 * @param ctx - Chat plugin context.
 */
export function registerRestartConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(restartDefinition)
}

/** Derived retired ranges; only a new restart revisits previously published nodes. */
export class RestartHistoryProjector {
  private readonly ranges = new Map<string, RestartState>()
  private readonly retiredProcesses = new Set<string>()
  private latestRequest: ChatNode<'restarted-history'> | undefined

  /**
   * Resolve a closed turn that claimed a restart but never admitted its input.
   * @param timeline - current turn index.
   * @returns the latest closed turn eligible for retry, or undefined.
   */
  unadmittedTurn(timeline: ConversationTimelineSnapshot): number | undefined {
    const request = this.latestRequest
    if (request === undefined || request.data.admitted) return undefined
    const latest = timeline.turnOrder.at(-1)
    const end = latest === undefined ? undefined : timeline.turns.get(latest)?.end
    if (end === undefined || request.anchorSeq >= end.seq) return undefined
    const previous = timeline.turnOrder.at(-2)
    const previousEnd = previous === undefined ? -1 : timeline.turns.get(previous)?.end?.seq
    return previousEnd !== undefined && request.anchorSeq > previousEnd ? latest : undefined
  }

  /**
   * Test whether a node belongs to a superseded branch.
   * @param node - Chat node, including synthetic fractional anchors.
   * @returns whether the node must leave Chat and its legacy projection.
   */
  readonly contains = (node: ChatConversationViewNode): boolean => {
    return this.retiredProcesses.has(node.key) || this.containsSeq(node.anchorSeq)
  }

  private containsSeq(seq: number): boolean {
    for (const range of this.ranges.values()) {
      if (seq >= range.fromSeq && seq < range.throughSeq + 1) return true
    }
    return false
  }

  /**
   * Rebuild from a complete or newly prepended event window.
   * @param nodes - unprojected Chat nodes.
   * @returns nodes with retired rows hidden.
   */
  replace(nodes: readonly ChatConversationViewNode[]): readonly ChatConversationViewNode[] {
    this.ranges.clear()
    this.latestRequest = undefined
    this.collect(nodes)
    this.collectEmptyProcesses(nodes)
    return nodes.map(node => this.project(node))
  }

  /**
   * Project changed nodes; revisit existing nodes only on new branch admission.
   * @param upserts - changed Chat nodes.
   * @param existing - lazy current store read.
   * @returns projected updates including newly retired rows.
   */
  apply(
    upserts: readonly ChatConversationViewNode[], existing: () => readonly ChatConversationViewNode[],
  ): readonly ChatConversationViewNode[] {
    const changed = this.collect(upserts)
    if (!changed) return upserts.map(node => this.project(node))
    const current = new Map(existing().map(node => [node.key, node]))
    for (const node of upserts) current.set(node.key, node)
    this.collectEmptyProcesses([...current.values()])
    const updates = new Map(upserts.map(node => [node.key, this.project(node)]))
    for (const node of current.values()) {
      if (updates.has(node.key)) continue
      const projected = this.project(node)
      // Include already-hidden assistants so legacy statistics retire too.
      if (projected !== node || this.contains(node)) updates.set(node.key, projected)
    }
    return [...updates.values()]
  }

  private collect(nodes: readonly ChatConversationViewNode[]): boolean {
    let changed = false
    for (const raw of nodes) {
      const node = raw as ChatNode
      if (node.kind !== 'restarted-history') continue
      if (this.latestRequest === undefined || node.anchorSeq >= this.latestRequest.anchorSeq) this.latestRequest = node
      if (!node.data.admitted || this.ranges.has(node.key)) continue
      this.ranges.set(node.key, node.data)
      changed = true
    }
    return changed
  }

  private collectEmptyProcesses(nodes: readonly ChatConversationViewNode[]): void {
    this.retiredProcesses.clear()
    const retainedTurns = new Set<number>()
    for (const node of nodes) {
      if (!isVisibleChatNode(node as ChatNode) || node.kind === 'turn-process' || this.containsSeq(node.anchorSeq)) continue
      if (node.location.kind === 'turn' || node.location.kind === 'step') retainedTurns.add(node.location.turn.turn)
    }
    for (const node of nodes) {
      if (node.kind !== 'turn-process' || (node.location.kind !== 'turn' && node.location.kind !== 'step')) continue
      const turn = node.location.turn
      if (turn.end !== undefined && this.containsSeq(turn.end.seq) && !retainedTurns.has(turn.turn)) {
        this.retiredProcesses.add(node.key)
      }
    }
  }

  private project(node: ChatConversationViewNode): ChatConversationViewNode {
    return node.visibility === 'visible' && this.contains(node) ? { ...node, visibility: 'hidden' } : node
  }
}
