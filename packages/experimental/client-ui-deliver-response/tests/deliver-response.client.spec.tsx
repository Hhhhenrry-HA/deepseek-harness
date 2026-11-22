// @vitest-environment jsdom
/** Exercise the optional contribution through the slot renderer and a scripted Host settings scope. */
import { act, fireEvent } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { apply as applyChat, inject as injectChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import { apply as applyConversation, inject as injectConversation, UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as applyTool, inject as injectTool, type ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { useState } from 'react'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { WorkRequirements } from '../src/client/DeliverResponseSettings.tsx'
import { en } from '../src/client/locales.ts'

const bundle = '@deepseek-ai/dsh-experimental-deliver-response-bundle'
const toolName = 'deliver_response'

async function fixture(transcriptView?: 'compact' | 'verbose') {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const host = stubConfigForm<WorkRequirements>()
  const chat = stubConfigForm<{ transcriptView: 'compact' | 'verbose' }>()
  if (transcriptView !== undefined) chat.publish({ status: 'ready', value: { transcriptView } })
  runtime.ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(false) }, get: (id: string) => {
    if (id === 'deliver-response') return host.scope
    return id === 'ui-chat' ? chat.scope : stubConfigForm().scope
  } } as never)
  const locale = new LocaleRuntime(runtime.ctx, undefined, { languages: ['en'], preference: 'en' })
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  if (transcriptView !== undefined) {
    runtime.remote.provideNamespaces({ session: { openWorkspacePath: vi.fn() } })
    runtime.ctx.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    runtime.ctx.provide('sidebarRight', { openResource: vi.fn() } as never)
    runtime.ctx.provide('uiWorkspace', { openWorkspace: vi.fn(), openSession: vi.fn() } as never)
    await runtime.root.declare({ main: { kind: 'keyed', scope: 'root' } }, ChatRoot)
    await runtime.mount({ apply: applyConversation, inject: injectConversation })
    await runtime.mount({ apply: applyChat, inject: injectChat })
    await runtime.mount({ apply: applyTool, inject: injectTool })
  } else {
    await runtime.mount({ inject: ['sessions'], apply: (ctx) => { ctx.plugin(UiConversation, ctx.sessions) } })
    await runtime.declare({
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    })
  }
  const mount = async () => await runtime.mount({ apply, inject })
  return { runtime, host, mount }
}

function ChatRoot({ renderSlot }: PropsRenderSlots<'main'>) {
  return <>{renderSlot('main', {}, { entryKey: 'conversation' })}</>
}

it('stages edits, keeps a stale draft visible on failure, discards it, and saves a reset to the inherited value', async () => {
  const { runtime, host, mount } = await fixture()
  const base = { workRequirements: 'Default from Host\nSecond line' }
  const user = { workRequirements: 'Stored override' }
  const newer = { workRequirements: 'Newer Host override' }
  const draft = '  Keep whitespace\nKeep every line  '
  try {
    host.publish({ status: 'ready', value: user, base, user, writable: true, revision: 9 })
    const config = runtime.renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: bundle }).view
    expect(config.queryByRole('textbox')).toBeNull()
    const feature = await mount()
    const editor = config.getByRole('textbox', { name: en.requirements })
    const save = config.getByRole('button', { name: en.save })
    expect(editor).toHaveProperty('value', user.workRequirements)
    expect(save).toHaveProperty('disabled', true)
    fireEvent.change(editor, { target: { value: draft } })
    expect(host.mutate).not.toHaveBeenCalled()
    act(() => { host.publish({ value: newer, user: newer, revision: 10 }) })
    host.mutate.mockImplementationOnce(async (_ops, _revision, onRejected) => {
      onRejected?.('revision conflict')
      return false
    })
    await act(async () => { fireEvent.click(save) })
    expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['workRequirements'], value: draft }], 9, expect.any(Function))
    expect(config.getByRole('status').textContent).toContain('revision conflict')
    expect(editor).toHaveProperty('value', draft)
    fireEvent.click(config.getByRole('button', { name: en.discard }))
    expect(editor).toHaveProperty('value', newer.workRequirements)
    expect(config.queryByRole('status')).toBeNull()

    fireEvent.click(config.getByRole('button', { name: en.reset }))
    expect(editor).toHaveProperty('value', base.workRequirements)
    expect(host.mutate).toHaveBeenCalledTimes(1)
    host.mutate.mockImplementationOnce(async () => {
      host.publish({ value: base, user: {}, revision: 11 })
      return true
    })
    await act(async () => { fireEvent.click(save) })
    expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['workRequirements'] }], 10, expect.any(Function))
    expect(editor).toHaveProperty('value', base.workRequirements)
    expect(config.getByRole('status')).toBeTruthy()
    expect(save).toHaveProperty('disabled', true)

    fireEvent.change(editor, { target: { value: 'Unsaved when disabled' } })
    await feature.dispose()
    expect(config.queryByRole('textbox')).toBeNull()
    expect(host.listenerCount()).toBe(0)
    await mount()
    expect(config.getByRole('textbox')).toHaveProperty('value', base.workRequirements)
  } finally { await runtime.dispose() }
})

it('does not offer edits before Host settings arrive or while the document is read-only', async () => {
  const { runtime, host, mount } = await fixture()
  try {
    await mount()
    const config = runtime.renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: bundle }).view
    expect(config.queryByRole('textbox')).toBeNull()
    expect(config.getByRole('status')).toBeTruthy()
    act(() => { host.publish({ status: 'ready', value: { workRequirements: 'Managed' }, revision: 7 }) })
    expect(config.getByRole('textbox')).toHaveProperty('disabled', true)
    expect(config.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(host.mutate).not.toHaveBeenCalled()
  } finally { await runtime.dispose() }
})

function useDisclosure() {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded, toggle: () => { setExpanded(value => !value) } }
}

it('keeps delivery activity compact and restores the ordinary tool card on unload', async () => {
  const { runtime, mount } = await fixture()
  const callId = 'delivery-1'
  const argsRaw = '{"body":"# Uncommitted draft"}'
  const args = PartialArguments.fromText(argsRaw)
  const inspect = vi.fn()
  const common = { toolName, callId, openFile: vi.fn(), loadImage: vi.fn(), useDisclosure, inspect }
  const started: ToolCallOwnerProps = { ...common, phase: 'start', block: {
    phase: 'start', name: toolName, argsRaw, args, callId, turn: 1, step: 1, time: 1, subCalls: [],
  } }
  const result: Extract<ToolCallOwnerProps, { phase: 'result' }> = { ...common, phase: 'result', block: {
    kind: 'tool-result', seq: 2, time: 2, name: toolName, args, callId, callTime: 1,
    call: { name: toolName, argsRaw }, isError: false, content: [],
    meta: { kind: 'deliver-response', body: '# Delivered\n\n- A **formatted** item.' }, subCalls: [],
  } }
  try {
    const sessionId = SessionId('delivery-ui')
    await runtime.sessions.add({ id: sessionId })
    const session = runtime.sessions.retainFor(runtime.ctx, sessionId, { source: 'mainView' })
    await session.ready
    const feature = await mount()
    const fallback = <p>Original tool view</p>
    const deliveryOpts = { entryKey: toolName, session, fallback }
    const tool = runtime.renderSlot('tool.call.toolview', started, deliveryOpts)
    expect(tool.view.queryByRole('heading')).toBeNull()
    tool.update(result)
    expect(tool.view.getByRole('button', { name: en.delivered })).toBeTruthy()
    expect(tool.view.queryByRole('heading')).toBeNull()
    expect(tool.view.queryByText('Uncommitted draft')).toBeNull()

    tool.update({ ...result, block: { ...result.block, isError: true, content: [{ type: 'text', text: 'Delivery refused' }] } })
    expect(tool.view.queryByRole('heading')).toBeNull()
    fireEvent.click(tool.view.getByRole('button', { name: en.failed }))
    expect(tool.view.getByText('Delivery refused')).toBeTruthy()
    fireEvent.click(tool.view.getByRole('button', { name: en.inspect }))
    expect(inspect).toHaveBeenCalledOnce()

    tool.update({ ...result, block: { ...result.block, isError: true, error: { name: 'ToolError', code: 'interrupted' } } })
    expect(tool.view.getByRole('button', { name: en.stopped })).toBeTruthy()
    tool.update({ ...result, block: { ...result.block, meta: { kind: 'deliver-response', body: 42 } } })
    expect(tool.view.queryByRole('heading')).toBeNull()
    tool.update({ ...result, block: { ...result.block, meta: null } })
    applyHost()
    tool.update(result, { entryKey: 'read_work_requirements', session, fallback })
    expect(tool.view.getByText('Original tool view')).toBeTruthy()
    tool.update(result, deliveryOpts)
    await feature.dispose()
    expect(tool.view.queryByRole('heading')).toBeNull()
    expect(tool.view.getByText('Original tool view')).toBeTruthy()
  } finally { await runtime.dispose() }
})

function deliveryEvents(): Array<{ type: 'event'; event: SessionEvent }> {
  const callId = ToolCallId('delivery-1')
  const rejectedCallId = ToolCallId('rejected-delivery')
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: SessionSeq(1), time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: SessionSeq(2), time: 2, data: { turn: 1, step: 1 } },
    { type: 'tool/call', seq: SessionSeq(3), time: 3, data: {
      turn: 1, step: 1, callId: rejectedCallId, name: toolName, arguments: '{"body":"# Uncommitted draft"}',
    } },
    { type: 'tool/result', seq: SessionSeq(4), time: 4, surfaceOp: 'append', data: {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: rejectedCallId, content: [], isError: true }),
      meta: { kind: 'deliver-response', body: '# Rejected' },
    } },
    { type: 'tool/call', seq: SessionSeq(5), time: 5, data: {
      turn: 1, step: 1, callId, name: toolName, arguments: '{"body":"# Uncommitted draft"}',
    } },
    { type: 'tool/result', seq: SessionSeq(6), time: 6, surfaceOp: 'append', data: {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId, content: [], isError: false }),
      meta: { kind: 'deliver-response', body: replyBody },
    } },
    { type: 'step/end', seq: SessionSeq(7), time: 7, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(8), time: 8, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return events.map(event => ({ type: 'event', event }))
}

const replyBody = '# Delivered reply\n\n- A **formatted** item.'

it.sequential.each(['compact', 'verbose'] as const)('keeps one committed Markdown reply across optional activation and unload in %s mode', async (mode) => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  try {
    const { runtime, mount } = await fixture(mode)
    try {
      const sessionId = SessionId('closed-delivery')
      await runtime.sessions.add({ id: sessionId, summary: { title: 'Delivery', displayTitle: 'Delivery', cwd: '/work' }, events: deliveryEvents() })
      await runtime.sessions.retainFor(runtime.ctx, sessionId, { source: 'mainView' }).ready
      const view = runtime.renderRoot()
      const heading = view.getByRole('heading', { name: 'Delivered reply' })
      expect(heading.closest('[data-turn-process-member], [data-step-process]')).toBeNull()
      const activity = view.container.querySelector('[data-chat-flow-kind="tool-call"]')
      expect(activity).not.toBeNull()
      expect(activity?.hasAttribute('data-turn-process-hidden')).toBe(mode === 'compact')
      expect(view.getByRole('listitem').querySelector('strong')?.textContent).toBe('formatted')
      expect(view.queryByRole('heading', { name: 'Rejected' })).toBeNull()
      expect(view.queryByRole('heading', { name: 'Uncommitted draft' })).toBeNull()
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Copy reply' })) })
      expect(writeText).toHaveBeenCalledExactlyOnceWith(replyBody)
      const feature = await mount()
      expect(view.getAllByRole('heading', { name: 'Delivered reply' })).toHaveLength(1)
      await feature.dispose()
      expect(view.getAllByRole('heading', { name: 'Delivered reply' })).toHaveLength(1)
      await mount()
      expect(view.getAllByRole('heading', { name: 'Delivered reply' })).toHaveLength(1)
    } finally { await runtime.dispose() }
  } finally {
    vi.unstubAllGlobals()
    if (fonts === undefined) Reflect.deleteProperty(document, 'fonts')
    else Object.defineProperty(document, 'fonts', fonts)
    if (clipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', clipboard)
  }
})
