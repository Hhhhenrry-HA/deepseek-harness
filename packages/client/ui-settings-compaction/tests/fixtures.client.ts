import { Context } from '@deepseek-ai/cordis'
import { onTestFinished, vi } from 'vitest'
import { stubConfigForm, TestRemote, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelRouteGroup } from '@deepseek-ai/dsh-client-ui-primitives'
import { CompactionSettingsController, type CompactionSettings, type CompactionSettingsFace } from '../src/client/controller.ts'

type FormSnapshot = ReturnType<CompactionSettingsFace['hooks']['compactionForm']['getSnapshot']>
type CatalogSnapshot = ReturnType<CompactionSettingsFace['hooks']['compactionCatalog']['getSnapshot']>

export type CatalogResult = Awaited<ReturnType<Context['remote']['session']['modelCatalog']>>

export const directory: readonly ModelRouteGroup[] = [{
  id: 'alpha', name: 'Alpha', models: [
    { id: 'fast', name: 'Fast', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } },
    { id: 'deep', name: 'Deep', reasoning: { efforts: [{ id: 'high', name: 'High' }] } },
  ],
}]

export function catalog(
  groups: readonly ModelRouteGroup[] = directory,
  failures: readonly { id: string; name: string; message: string }[] = [],
): CatalogResult {
  return { ok: true, value: {
    default: { provider: 'conversation-default', model: 'chat-id' },
    routableProviders: groups.filter(group => group.models.length > 0).map(group => group.id),
    groups, failures,
  } }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

export function fixture(options: {
  value?: CompactionSettings
  writable?: boolean
  load?: () => Promise<CatalogResult>
} = {}) {
  const host = stubConfigForm<CompactionSettings>()
  host.publish({
    status: 'ready', writable: options.writable ?? true, revision: 7,
    value: options.value ?? { model: null, reasoningEffort: null }, user: {},
  })
  const ctx = new Context()
  const load = vi.fn(options.load ?? (() => Promise.resolve(catalog())))
  new TestRemote(ctx, { session: { modelCatalog: load } })
  const controller = new CompactionSettingsController(host.scope, ctx)
  onTestFinished(() => { controller.dispose() })
  const face: CompactionSettingsFace = controller.inject()
  return {
    host, controller, face, load,
    form: (): FormSnapshot => face.hooks.compactionForm.getSnapshot(),
    catalogState: (): CatalogSnapshot => face.hooks.compactionCatalog.getSnapshot(),
  }
}

/** Publish only mutations accepted by the scripted Host. */
export function acceptWrites(host: StubConfigForm<CompactionSettings>): void {
  host.mutate.mockImplementation((ops, revision) => {
    if (revision === undefined || revision !== host.scope.getSnapshot().revision) return Promise.resolve(false)
    const value = { ...host.scope.getSnapshot().value }
    for (const op of ops) {
      if (op.op === 'set' && op.path[0] === 'model') value.model = op.value as CompactionSettings['model']
      if (op.op === 'set' && op.path[0] === 'reasoningEffort') value.reasoningEffort = op.value as string | null
    }
    host.publish({ value: value as CompactionSettings, revision: revision + 1 })
    return Promise.resolve(true)
  })
}
