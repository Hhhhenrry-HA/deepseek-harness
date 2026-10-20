// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelRouteFields, type ModelRouteFieldsProps } from '../src/ModelRouteFields.tsx'
import { modelRouteCandidates, modelRouteKey } from '../src/model-route.ts'

afterEach(cleanup)

const fast = { provider: 'alpha', model: 'fast-id' }
const deep = { provider: 'alpha', model: 'deep-id' }
const saved = { provider: 'legacy', model: 'saved-id' }
const groups = [{ id: 'alpha', name: 'Alpha provider', models: [
  { id: fast.model, name: 'Fast model', reasoning: { efforts: [{ id: 'low-id', name: 'Low effort' }, { id: 'high-id', name: 'High effort' }] } },
  { id: deep.model, name: 'Deep model' },
] }]
const labels = { title: 'route-field-id', unavailable: 'unavailable-id', unavailableGroup: 'unavailable-group-id', effort: 'effort-field-id', defaultEffort: 'default-effort-id' }

function props(overrides: Partial<ModelRouteFieldsProps> = {}): ModelRouteFieldsProps {
  return {
    candidates: modelRouteCandidates(groups, [], new Set([modelRouteKey(fast)])),
    reasoningEffort: null, disabled: false, labels, onSelect: vi.fn(), onEffort: vi.fn(), ...overrides,
  }
}

describe('ModelRouteFields', () => {
  it('dispatches exact route keys and null for the optional follow/default choice', () => {
    const input = props({ defaultChoice: { label: 'follow-route-id', selected: false } })
    render(<ModelRouteFields {...input} />)
    expect(screen.getByRole('group', { name: labels.title })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /alpha\/fast-id/ })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('radio', { name: /alpha\/deep-id/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'follow-route-id' }))
    expect(input.onSelect).toHaveBeenNthCalledWith(1, modelRouteKey(deep))
    expect(input.onSelect).toHaveBeenNthCalledWith(2, null)
  })

  it('offers adapter effort IDs and maps the model-default option to null', () => {
    const input = props({ reasoningEffort: 'low-id' })
    render(<ModelRouteFields {...input} />)
    const effort = screen.getByRole('combobox', { name: labels.effort }) as HTMLSelectElement
    expect(effort.value).toBe('low-id')
    expect([...effort.options].map(option => option.value)).toEqual(['', 'low-id', 'high-id'])
    fireEvent.change(effort, { target: { value: 'high-id' } })
    fireEvent.change(effort, { target: { value: '' } })
    expect(input.onEffort).toHaveBeenNthCalledWith(1, 'high-id')
    expect(input.onEffort).toHaveBeenNthCalledWith(2, null)
  })

  it('keeps an unavailable route and unknown saved effort selectable without inventing advertised metadata', () => {
    const input = props({
      candidates: modelRouteCandidates(groups, [saved], new Set([modelRouteKey(saved)])),
      reasoningEffort: 'saved-effort-id',
    })
    render(<ModelRouteFields {...input} />)
    const radio = screen.getByRole('radio', { name: /legacy\/saved-id/ })
    expect(radio).toHaveProperty('checked', true)
    expect(radio).toHaveProperty('disabled', false)
    const effort = screen.getByRole('combobox') as HTMLSelectElement
    expect(effort.value).toBe('saved-effort-id')
    expect([...effort.options].map(option => option.value)).toEqual(['', 'saved-effort-id'])
    fireEvent.change(effort, { target: { value: '' } })
    expect(input.onEffort).toHaveBeenCalledWith(null)
  })

  it('omits effort for default mode or a route that advertises no efforts, but keeps model default for reasoning models', () => {
    const input = props({ candidates: modelRouteCandidates(groups, [], new Set()), defaultChoice: { label: 'follow-route-id', selected: true } })
    const view = render(<ModelRouteFields {...input} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    view.rerender(<ModelRouteFields {...props({ candidates: modelRouteCandidates(groups, [], new Set([modelRouteKey(deep)])) })} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    view.rerender(<ModelRouteFields {...props()} />)
    expect(screen.getByRole('combobox')).toHaveProperty('value', '')
  })

  it('disables every route and effort together', () => {
    render(<ModelRouteFields {...props({ disabled: true, defaultChoice: { label: 'follow-route-id', selected: false } })} />)
    for (const control of screen.getAllByRole('radio')) expect(control).toHaveProperty('disabled', true)
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
  })

  it('isolates radio groups and effort-label associations between simultaneous consumers', () => {
    render(<><ModelRouteFields {...props()} /><ModelRouteFields {...props()} /></>)
    const fields = screen.getAllByRole('group')
    const first = within(fields[0]!).getAllByRole('radio')
    const second = within(fields[1]!).getAllByRole('radio')
    expect(first[0]?.getAttribute('name')).toBe(first[1]?.getAttribute('name'))
    expect(first[0]?.getAttribute('name')).not.toBe(second[0]?.getAttribute('name'))
    const efforts = screen.getAllByRole('combobox', { name: labels.effort })
    expect(efforts[0]?.id).not.toBe(efforts[1]?.id)
  })
})
