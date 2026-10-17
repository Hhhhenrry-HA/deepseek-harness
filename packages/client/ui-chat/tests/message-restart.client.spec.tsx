// @vitest-environment jsdom

/** Message-action contracts: losing drafts or retrying the wrong turn corrupts user work. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import { TurnTailNodeView } from '../src/client/chat/TurnTailNodeView.tsx'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import type { MessageRestartInjected } from '../src/client/chat/use-message-restart.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'
import { ChatSnapshotBuilder } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'

const t = makeTranslate(zh, commonZh)
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function user(restartMessage: MessageRestartInjected['restartMessage'], running = false) {
  const props: Partial<ChatNodeViewProps<'user'>> = {
    node: { key: 'user:2', id: '2', kind: 'user', target: 'chat', anchorSeq: 2,
      visibility: 'visible', location: { kind: 'session' },
      data: { kind: 'user', seq: 2, time: 0, content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } } },
    sessionId: SessionId('test'), renderMessageImages: () => null, openFile: vi.fn(), openSkill: vi.fn(), t,
    useSession: select => select({ running, pendingSubmissions: [] } as never),
  }
  return <UserMessageNodeView {...props as ChatNodeViewProps<'user'>} restartMessage={restartMessage} />
}

describe('message restart actions', () => {
  it('cancels editing without changing the original message or sending a request', () => {
    const restart = vi.fn(async () => null)
    render(user(restart))
    fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft' } })
    fireEvent.click(screen.getByRole('button', { name: t('message.cancelEdit') }))
    expect(screen.getByText('original')).toBeTruthy()
    expect(restart).not.toHaveBeenCalled()
  })

  it('retains a rejected draft and reuses the request id after uncertain transport failure', async () => {
    const restart = vi.fn<MessageRestartInjected['restartMessage']>()
      .mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue(null)
    render(user(restart))
    fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: t('message.resend') }))
    await screen.findByRole('alert')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('edited')
    fireEvent.click(screen.getByRole('button', { name: t('message.resend') }))
    await waitFor(() =>{  expect(restart).toHaveBeenCalledTimes(2) })
    expect(restart.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'test', seq: 2, action: { kind: 'edit', text: 'edited' } })
    expect(restart.mock.calls[1]?.[0].requestId).toBe(restart.mock.calls[0]?.[0].requestId)
  })

  it('does not begin editing during a running turn', () => {
    render(user(vi.fn(async () => null), true))
    fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('offers regeneration only for the latest closed human turn, including one without an answer', async () => {
    const restart = vi.fn(async () => null)
    const fixture = chatSnapshotFixture({
      nodes: [
        { kind: 'user', seq: 1, time: 0, source: null, content: [{ type: 'text', text: 'first' }] },
        { kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'answer' }] },
        { kind: 'user', seq: 4, time: 0, source: null, content: [{ type: 'text', text: 'second' }] },
      ], turnEnds: new Map([[1, 3], [2, 6]]),
    })
    const snapshot = new ChatSnapshotBuilder().replace({
      nodes: fixture.nodes.values().map(node => node.kind !== 'user' ? node : {
        ...node, location: { kind: 'turn', turn: fixture.timeline.turns.get(node.anchorSeq === 1 ? 1 : 2)! },
      }), timeline: fixture.timeline,
    })
    const props: Partial<ComponentProps<typeof TurnTailNodeView>> = {
      t, sessionId: SessionId('test'), renderSlot: () => null, forkAt: vi.fn(), openFile: vi.fn(),
      usePerformanceUsage: select => select('compact'),
      useSession: select => select({ running: false, pendingSubmissions: [] } as never),
      useChat: select => select(snapshot),
    }
    const tails = snapshot.nodes.values().filter(node => node.kind === 'turn-tail')
    render(<>{tails.map(node => <TurnTailNodeView key={node.key} {...props as Omit<ComponentProps<typeof TurnTailNodeView>, 'node' | 'restartMessage'>}
      node={node as ChatNodeViewProps<'turn-tail'>['node']} restartMessage={restart} />)}</>)
    expect(screen.getAllByRole('button', { name: t('message.regenerate') })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: t('message.regenerate') }))
    await waitFor(() =>{  expect(restart).toHaveBeenCalledWith(expect.objectContaining({ seq: 6, action: { kind: 'retry' } })) })
  })
})
