// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { CompactionCard, type CompactionCardProps } from '../src/client/CompactionCard.tsx'
import { acceptWrites, catalog, deferred, fixture, type CatalogResult } from './fixtures.client.ts'

afterEach(cleanup)

function renderCard(subject: ReturnType<typeof fixture>, view: 'summary' | 'page' = 'page') {
  const { hooks, ...actions } = subject.face
  const props = {
    ...actions, view,
    // Locale keys are semantic fixture labels, not assertions about product copy.
    t: (key: string) => key,
    useCompactionForm: bindSnapshotSelector(hooks.compactionForm),
    useCompactionCatalog: bindSnapshotSelector(hooks.compactionCatalog),
  } as CompactionCardProps
  return render(<CompactionCard {...props} />)
}

function route(model: 'fast' | 'deep') {
  return screen.getByRole('radio', { name: new RegExp(`alpha/${model}`) })
}

describe('CompactionCard', () => {
  it('renders its summary without form controls', async () => {
    const subject = fixture()
    renderCard(subject, 'summary')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.body.textContent?.length).toBeGreaterThan(0)
    await act(async () => { await Promise.resolve() })
  })

  it('edits route and effort through framework-bound props and leaves the form open after saving', async () => {
    const subject = fixture()
    acceptWrites(subject.host)
    renderCard(subject)
    await screen.findByRole('radio', { name: /alpha\/deep/ })
    fireEvent.click(route('deep'))
    const effort = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(effort, { target: { value: 'high' } })
    expect(effort.value).toBe('high')
    expect(subject.host.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await screen.findByRole('button', { name: 'save' })
    expect(subject.form()).toMatchObject({ dirty: false, saving: false })
    expect(route('deep')).toHaveProperty('checked', true)
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'high')
    expect(screen.getByRole('button', { name: 'save' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('status').textContent?.length).toBeGreaterThan(0)
  })

  it('offers follow/default as a null route and hides route-specific effort', async () => {
    const subject = fixture({ value: { model: { provider: 'alpha', model: 'deep' }, reasoningEffort: 'high' } })
    acceptWrites(subject.host)
    renderCard(subject)
    await screen.findByRole('combobox')
    fireEvent.click(screen.getByRole('radio', { name: 'follow' }))
    expect(screen.getByRole('radio', { name: 'follow' })).toHaveProperty('checked', true)
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await vi.waitFor(() => { expect(subject.host.scope.getSnapshot().value).toEqual({ model: null, reasoningEffort: null }) })
  })

  it('discards dirty route and effort when leaving the page', async () => {
    const subject = fixture()
    const view = renderCard(subject)
    await screen.findByRole('radio', { name: /alpha\/deep/ })
    fireEvent.click(route('deep'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } })
    view.unmount()
    expect(subject.form()).toMatchObject({ dirty: false, selected: '', reasoningEffort: null })
    expect(subject.host.mutate).not.toHaveBeenCalled()
  })

  it('renders unavailable state without controls and read-only state with disabled fields', async () => {
    const subject = fixture({ writable: false, value: { model: { provider: 'alpha', model: 'deep' }, reasoningEffort: 'high' } })
    renderCard(subject)
    await screen.findByRole('combobox')
    expect(screen.getByRole('status').textContent?.length).toBeGreaterThan(0)
    for (const control of screen.getAllByRole('radio')) expect(control).toHaveProperty('disabled', true)
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'save' })).toHaveProperty('disabled', true)
    act(() => { subject.host.publish({ status: 'unavailable' }) })
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status').textContent?.length).toBeGreaterThan(0)
  })

  it('preserves a dirty draft but refuses writes when the deployment becomes read-only', async () => {
    const subject = fixture()
    renderCard(subject)
    await screen.findByRole('radio', { name: /alpha\/deep/ })
    fireEvent.click(route('deep'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } })
    act(() => { subject.host.publish({ writable: false }) })
    for (const control of screen.getAllByRole('radio')) expect(control).toHaveProperty('disabled', true)
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
    const save = screen.getByRole('button', { name: 'save' })
    expect(save).toHaveProperty('disabled', true)
    fireEvent.click(save)
    expect(subject.host.mutate).not.toHaveBeenCalled()
    expect(subject.form()).toMatchObject({ selected: 'alpha\0deep', reasoningEffort: 'high', dirty: true })
    expect(screen.getByRole('status').textContent?.length).toBeGreaterThan(0)
  })

  it.each(['rejected', 'conflict'] as const)('keeps %s save feedback visible alongside the dirty values', async (failure) => {
    const subject = fixture()
    subject.host.mutate.mockImplementation((_ops, _revision, rejected) => {
      rejected?.(`${failure}-reason-id`)
      return Promise.resolve(false)
    })
    renderCard(subject)
    await screen.findByRole('radio', { name: /alpha\/deep/ })
    fireEvent.click(route('deep'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } })
    if (failure === 'conflict') act(() => { subject.host.publish({ revision: 8 }) })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await vi.waitFor(() => { expect(subject.form().failed).toBe(true) })
    expect(screen.getByRole('status').textContent).toContain(`${failure}-reason-id`)
    expect(route('deep')).toHaveProperty('checked', true)
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'high')
    expect(screen.getByRole('button', { name: 'save' })).toHaveProperty('disabled', false)
  })

  it('locks route, effort, and save controls while the atomic write is pending', async () => {
    const pending = deferred<boolean>()
    const subject = fixture()
    subject.host.mutate.mockReturnValue(pending.promise)
    renderCard(subject)
    await screen.findByRole('radio', { name: /alpha\/deep/ })
    fireEvent.click(route('deep'))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    for (const control of screen.getAllByRole('radio')) expect(control).toHaveProperty('disabled', true)
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'saving' })).toHaveProperty('disabled', true)
    await act(async () => { pending.resolve(false); await pending.promise })
  })

  it('renders catalog loading and actionable failure/retry while keeping a saved unavailable route and effort', async () => {
    const pending = deferred<CatalogResult>()
    const subject = fixture({
      value: { model: { provider: 'legacy', model: 'saved' }, reasoningEffort: 'retired-effort-id' },
      load: () => pending.promise,
    })
    renderCard(subject)
    expect(screen.getByRole('status').textContent?.length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: /legacy\/saved/ })).toHaveProperty('checked', true)
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'retired-effort-id')
    await act(async () => { pending.reject(new Error('catalog-failure-id')); await pending.promise.catch(() => undefined) })
    expect(screen.getByRole('alert')).toBeTruthy()
    subject.load.mockResolvedValueOnce(catalog())
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await screen.findByRole('radio', { name: /alpha\/deep/ })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('radio', { name: /legacy\/saved/ })).toHaveProperty('checked', true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(subject.form().reasoningEffort).toBeNull()
  })
})
