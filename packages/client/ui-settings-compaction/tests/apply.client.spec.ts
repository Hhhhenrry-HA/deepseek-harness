import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { CompactionSettingsFace } from '../src/client/controller.ts'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { catalog } from './fixtures.client.ts'

const namespace = 'compaction-model-selection-settings'
const schema = { uid: 1, refs: { 1: { type: 'object', dict: {} } } }

function Root({ renderSlot }: PropsRenderSlots<'plugins.item'>) {
  return renderSlot('plugins.item', { view: 'summary' })
}

async function bench(served: readonly string[]) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const load = vi.fn(() => Promise.resolve(catalog()))
  const describeSettings = vi.fn(() => Promise.resolve({
    ok: true as const, value: {
      writable: true, hasDocument: true,
      namespaces: served.map(ns => ({
        ns, schema, value: { model: null, reasoningEffort: null }, applies: 'live', secrets: [], revision: 4,
      })),
    },
  }))
  const remote = new TestRemote(ctx, { session: { modelCatalog: load }, settings: { describe: describeSettings } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareRoot = () => slots.register({ name: 'root', children: { 'plugins.item': { kind: 'list', scope: 'root' } } }, Root)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, remote, load, slots, fiber, declareRoot, describeSettings }
}

describe('compaction settings page lifecycle', () => {
  it.each([
    { served: [namespace], expected: 1 },
    { served: ['compaction'], expected: 0 },
    { served: ['subagent-model-selection-settings'], expected: 0 },
    { served: [], expected: 0 },
  ])('registers only for the independently served model preference: $served', async ({ served, expected }) => {
    const subject = await bench(served)
    subject.declareRoot()
    await vi.waitFor(() => { expect(subject.ctx.configForms.get(namespace).getSnapshot().status).not.toBe('loading') })
    expect(subject.slots.entries('plugins.item')).toHaveLength(expected)
    if (expected) {
      expect(subject.slots.entries('plugins.item')[0]?.options.id).toBe('compaction')
    }
  })

  it('waits for the parent slot, collapses with it, and registers again when it returns', async () => {
    const subject = await bench([namespace])
    await vi.waitFor(() => { expect(subject.describeSettings).toHaveBeenCalled() })
    expect(subject.slots.entries('plugins.item')).toHaveLength(0)
    const release = subject.declareRoot()
    await vi.waitFor(() => { expect(subject.slots.entries('plugins.item')).toHaveLength(1) })
    release()
    expect(subject.slots.entries('plugins.item')).toHaveLength(0)
    subject.declareRoot()
    await vi.waitFor(() => { expect(subject.slots.entries('plugins.item')).toHaveLength(1) })
  })

  it('refreshes from live directory inputs and connection reset, then releases page and listeners on unload', async () => {
    const subject = await bench([namespace])
    subject.declareRoot()
    await vi.waitFor(() => { expect(subject.slots.entries('plugins.item')).toHaveLength(1) })
    const entry = subject.slots.entries('plugins.item')[0]!
    const face = (entry.inject as () => CompactionSettingsFace)()
    await vi.waitFor(() => { expect(face.hooks.compactionCatalog.getSnapshot().status).toBe('ready') })
    face.selectModel('alpha\0deep')
    face.setEffort('high')
    expect(face.hooks.compactionForm.getSnapshot().dirty).toBe(true)
    subject.load.mockClear()

    subject.remote.emit('llm/adapters-updated', [])
    expect(subject.load).toHaveBeenCalledTimes(1)
    subject.remote.emit('settings/document-updated', ['llm-deepseek', 5])
    expect(subject.load).toHaveBeenCalledTimes(2)
    subject.ctx.emit('connection/reset')
    expect(subject.load).toHaveBeenCalledTimes(3)
    expect(face.hooks.compactionForm.getSnapshot().dirty).toBe(false)

    await subject.fiber.dispose()
    expect(subject.slots.entries('plugins.item')).toHaveLength(0)
    subject.remote.emit('llm/adapters-updated', [])
    subject.remote.emit('settings/document-updated', ['llm-deepseek', 6])
    subject.ctx.emit('connection/reset')
    expect(subject.load).toHaveBeenCalledTimes(3)
  })
})
