import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { modelRouteCandidates } from '@deepseek-ai/dsh-client-ui-primitives'
import { acceptWrites, catalog, deferred, fixture, type CatalogResult } from './fixtures.client.ts'

const fast = { provider: 'alpha', model: 'fast' }
const deep = { provider: 'alpha', model: 'deep' }

function choices(subject: ReturnType<typeof fixture>) {
  return modelRouteCandidates(subject.catalogState().groups, subject.form().retained, new Set([subject.form().selected]))
}

describe('CompactionSettingsController', () => {
  it('stages the route and effort, then saves both in one revision-fenced mutation', async () => {
    const subject = fixture()
    acceptWrites(subject.host)
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })

    subject.face.selectModel('alpha\0deep')
    subject.face.setEffort('high')
    expect(subject.form()).toMatchObject({ selected: 'alpha\0deep', reasoningEffort: 'high', dirty: true })
    expect(subject.host.mutate).not.toHaveBeenCalled()
    subject.face.save()
    await vi.waitFor(() => { expect(subject.form()).toMatchObject({ dirty: false, saving: false }) })

    expect(subject.host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['model'], value: deep },
      { op: 'set', path: ['reasoningEffort'], value: 'high' },
    ], 7, expect.any(Function))
    expect(subject.host.scope.getSnapshot().value).toEqual({ model: deep, reasoningEffort: 'high' })
    expect(subject.host.set).not.toHaveBeenCalled()
    expect(subject.host.unset).not.toHaveBeenCalled()
  })

  it('sends explicit nulls for follow/default rather than clearing deployment defaults', async () => {
    const subject = fixture({ value: { model: deep, reasoningEffort: 'high' } })
    acceptWrites(subject.host)
    subject.face.selectModel(null)
    expect(subject.form()).toMatchObject({ selected: '', reasoningEffort: null, dirty: true })
    subject.face.save()
    await vi.waitFor(() => { expect(subject.form().dirty).toBe(false) })

    expect(subject.host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['model'], value: null },
      { op: 'set', path: ['reasoningEffort'], value: null },
    ], 7, expect.any(Function))
  })

  it('saves model-default effort as null without changing the saved route', async () => {
    const subject = fixture({ value: { model: fast, reasoningEffort: 'low' } })
    acceptWrites(subject.host)
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.face.setEffort(null)
    subject.face.save()
    await vi.waitFor(() => { expect(subject.form().dirty).toBe(false) })
    expect(subject.host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['reasoningEffort'], value: null },
    ], 7, expect.any(Function))
    expect(subject.host.scope.getSnapshot().value).toEqual({ model: fast, reasoningEffort: null })
  })

  it('resets effort when switching models and accepts only the selected model effort IDs', async () => {
    const subject = fixture({ value: { model: deep, reasoningEffort: 'high' } })
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.face.selectModel('alpha\0fast')
    expect(subject.form()).toMatchObject({ selected: 'alpha\0fast', reasoningEffort: null })
    subject.face.setEffort('high')
    subject.face.selectModel('missing\0route')
    expect(subject.form()).toMatchObject({ selected: 'alpha\0fast', reasoningEffort: null })
    subject.face.setEffort('low')
    expect(subject.form().reasoningEffort).toBe('low')
    subject.face.setEffort(null)
    expect(subject.form().reasoningEffort).toBeNull()
    subject.face.selectModel(null)
    subject.face.setEffort('low')
    expect(subject.form().reasoningEffort).toBeNull()
  })

  it('discards both dirty fields and restores the current accepted settings', async () => {
    const subject = fixture({ value: { model: fast, reasoningEffort: 'low' } })
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.face.selectModel('alpha\0deep')
    subject.face.setEffort('high')
    subject.face.discard()
    expect(subject.form()).toMatchObject({ selected: 'alpha\0fast', reasoningEffort: 'low', dirty: false, failed: false })
    expect(subject.form().retained).toEqual([fast])
    subject.face.save()
    expect(subject.host.mutate).not.toHaveBeenCalled()
  })

  it('blocks read-only edits and writes, including a draft that becomes read-only', async () => {
    const subject = fixture({ writable: false, value: { model: fast, reasoningEffort: 'low' } })
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.face.selectModel(null)
    subject.face.setEffort(null)
    subject.face.save()
    expect(subject.form()).toMatchObject({ dirty: false, selected: 'alpha\0fast', reasoningEffort: 'low' })
    subject.host.publish({ writable: true })
    subject.face.selectModel('alpha\0deep')
    subject.host.publish({ writable: false })
    subject.face.save()
    expect(subject.host.mutate).not.toHaveBeenCalled()
    expect(subject.form().dirty).toBe(true)
  })

  it.each(['rejection', 'conflict', 'transport'] as const)('retains drafts and exposes a %s for retry or discard', async (failure) => {
    const subject = fixture()
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.face.selectModel('alpha\0deep')
    subject.face.setEffort('high')
    if (failure === 'conflict') {
      subject.host.publish({ revision: 8, value: { model: fast, reasoningEffort: 'low' } })
    }
    subject.host.mutate.mockImplementation((_ops, _revision, rejected) => {
      if (failure === 'transport') return Promise.reject(new Error('transport-failure-id'))
      rejected?.(`${failure}-id`)
      return Promise.resolve(false)
    })
    subject.face.save()
    await vi.waitFor(() => { expect(subject.form()).toMatchObject({ failed: true, dirty: true, saving: false }) })
    expect(subject.host.mutate.mock.calls[0]?.[1]).toBe(7)
    expect(subject.form()).toMatchObject({ selected: 'alpha\0deep', reasoningEffort: 'high', saveResult: { status: 'failure' } })

    subject.face.discard()
    expect(subject.form()).toMatchObject({ failed: false, dirty: false, selected: failure === 'conflict' ? 'alpha\0fast' : '' })
    subject.face.selectModel('alpha\0deep')
    subject.face.setEffort('high')
    acceptWrites(subject.host)
    subject.face.save()
    await vi.waitFor(() => { expect(subject.form()).toMatchObject({ failed: false, dirty: false, saveResult: { status: 'success' } }) })
    expect(subject.host.mutate.mock.calls[1]?.[1]).toBe(failure === 'conflict' ? 8 : 7)
  })

  it('prevents duplicate saves and editing while a save is pending', async () => {
    const pending = deferred<boolean>()
    const subject = fixture()
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.host.mutate.mockReturnValue(pending.promise)
    subject.face.selectModel('alpha\0deep')
    subject.face.setEffort('high')
    subject.face.save()
    expect(subject.form().saving).toBe(true)
    subject.face.selectModel(null)
    subject.face.setEffort(null)
    subject.face.save()
    expect(subject.form()).toMatchObject({ selected: 'alpha\0deep', reasoningEffort: 'high' })
    expect(subject.host.mutate).toHaveBeenCalledOnce()
    pending.resolve(false)
    await vi.waitFor(() => { expect(subject.form().saving).toBe(false) })
  })

  it('retains both saved and dirty unavailable routes across directory refreshes', async () => {
    const refreshed = deferred<CatalogResult>()
    const subject = fixture({ value: { model: fast, reasoningEffort: 'low' } })
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.face.selectModel('alpha\0deep')
    subject.face.setEffort('high')
    subject.load.mockReturnValueOnce(refreshed.promise)
    const reload = subject.controller.refreshCatalog()
    expect(subject.catalogState().status).toBe('loading')
    expect(choices(subject).find(choice => choice.model === 'deep')?.selected).toBe(true)
    refreshed.resolve(catalog([]))
    await reload
    expect(choices(subject)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ...fast, available: false, selected: false }),
      expect.objectContaining({ ...deep, available: false, selected: true }),
    ]))
    expect(subject.form()).toMatchObject({ selected: 'alpha\0deep', reasoningEffort: 'high', dirty: true, invalid: false })
    acceptWrites(subject.host)
    subject.face.save()
    await vi.waitFor(() => { expect(subject.form().dirty).toBe(false) })
    expect(subject.host.scope.getSnapshot().value).toEqual({ model: deep, reasoningEffort: 'high' })
    subject.host.publish({ revision: 9, value: { model: fast, reasoningEffort: 'low' } })
    expect(subject.form().selected).toBe('alpha\0fast')
    expect(choices(subject).map(({ provider, model }) => ({ provider, model }))).toEqual([fast])
  })

  it('reports partial directories, failed refreshes, and explicit successful retry without losing the route', async () => {
    const subject = fixture({ value: { model: fast, reasoningEffort: 'low' } })
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.load.mockResolvedValueOnce(catalog([], [{ id: 'alpha', name: 'Alpha', message: 'provider-failure-id' }]))
    await subject.controller.refreshCatalog()
    expect(subject.catalogState()).toMatchObject({ status: 'ready', partial: true })
    expect(choices(subject)[0]).toMatchObject({ ...fast, available: false, selected: true })
    subject.load.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'catalog-failure-id', {}) })
    await subject.controller.refreshCatalog()
    expect(subject.catalogState()).toMatchObject({ status: 'error', partial: false })
    subject.load.mockRejectedValueOnce(new Error('catalog-transport-id'))
    await subject.controller.refreshCatalog()
    expect(subject.catalogState().status).toBe('error')
    subject.face.retryCatalog()
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    expect(choices(subject).find(choice => choice.model === 'fast')).toMatchObject({ available: true, selected: true })
  })

  it.each(['success', 'failure', 'throw'] as const)('ignores a late %s from the old connection after reset', async (outcome) => {
    const previous = deferred<CatalogResult>()
    const subject = fixture({ value: { model: fast, reasoningEffort: 'low' } })
    await vi.waitFor(() => { expect(subject.catalogState().status).toBe('ready') })
    subject.face.selectModel('alpha\0deep')
    subject.face.setEffort('high')
    subject.load.mockReturnValueOnce(previous.promise)
    const previousReload = subject.controller.refreshCatalog()
    subject.load.mockResolvedValueOnce(catalog([]))
    subject.controller.resetConnection()
    subject.host.publish({ value: { model: null, reasoningEffort: null } })
    await vi.waitFor(() => { expect(subject.catalogState()).toMatchObject({ status: 'ready', groups: [] }) })
    const afterReset = subject.catalogState()
    if (outcome === 'throw') previous.reject(new Error('late-failure-id'))
    else previous.resolve(outcome === 'success' ? catalog() : { ok: false, error: new RemoteError('gateway/internal', 'late-failure-id', {}) })
    await previousReload
    expect(subject.catalogState()).toBe(afterReset)
    expect(subject.form()).toMatchObject({ dirty: false, selected: '', reasoningEffort: null })
  })

  it('keeps the newest refresh when an earlier request settles last', async () => {
    const previous = deferred<CatalogResult>()
    const subject = fixture({ load: () => previous.promise })
    subject.load.mockResolvedValueOnce(catalog([]))
    await subject.controller.refreshCatalog()
    previous.resolve(catalog())
    await previous.promise
    expect(subject.catalogState()).toMatchObject({ status: 'ready', groups: [] })
  })

  it.each(['success', 'failure', 'throw'] as const)('disposal suppresses a late directory %s and releases configuration observation', async (outcome) => {
    const pending = deferred<CatalogResult>()
    const subject = fixture({ load: () => pending.promise })
    expect(subject.host.listenerCount()).toBe(1)
    const before = subject.catalogState()
    const formBefore = subject.form()
    subject.controller.dispose()
    expect(subject.host.listenerCount()).toBe(0)
    if (outcome === 'throw') pending.reject(new Error('late-failure-id'))
    else pending.resolve(outcome === 'success' ? catalog() : { ok: false, error: new RemoteError('gateway/internal', 'late-failure-id', {}) })
    await pending.promise.catch(() => undefined)
    await subject.controller.refreshCatalog()
    subject.host.publish({ value: { model: deep, reasoningEffort: 'high' } })
    expect(subject.catalogState()).toBe(before)
    expect(subject.form()).toBe(formBefore)
    expect(subject.load).toHaveBeenCalledOnce()
  })
})
