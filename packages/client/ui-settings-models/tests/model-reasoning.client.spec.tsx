// @vitest-environment jsdom
/** Reasoning declarations survive model edits and expose the requested protocol levels. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelReasoning } from '../src/client/ModelReasoning.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

describe('model reasoning declarations', () => {
  it.each(['openai-completions', 'openai-responses'])('declares every OpenAI level for %s', (api) => {
    const onChange = vi.fn()
    const model = { id: 'custom', contextWindow: 123456, input: ['text', 'image'], compat: { supportsDeveloperRole: false } }
    render(<ModelReasoning model={model} api={api} position={1} disabled={false} t={key => en[key]} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'openai' } })
    expect(onChange).toHaveBeenCalledWith({
      ...model,
      reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    })
    expect(model).not.toHaveProperty('reasoningEfforts')
  })

  it('declares Claude levels with adaptive thinking and preserves other compatibility fields', () => {
    const onChange = vi.fn()
    render(<ModelReasoning model={{ id: 'custom', compat: { supportsToolChoice: false } }} api="anthropic-messages" position={1} disabled={false} t={key => en[key]} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'claude' } })
    expect(onChange).toHaveBeenCalledWith({
      id: 'custom', compat: { supportsToolChoice: false, forceAdaptiveThinking: true },
      reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
    })
  })

  it.each(['inherit', 'disabled'])('restores %s without retaining the adaptive override', (value) => {
    const onChange = vi.fn()
    render(<ModelReasoning model={{ id: 'custom', reasoningEfforts: { max: 'custom-wire' }, compat: { forceAdaptiveThinking: true, supportsToolChoice: false } }} api="anthropic-messages" position={1} disabled={false} t={key => en[key]} onChange={onChange} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('custom')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value } })
    expect(onChange).toHaveBeenCalledWith({
      id: 'custom', compat: { supportsToolChoice: false },
      ...value === 'disabled' ? { reasoningEfforts: false } : {},
    })
  })

  it('keeps read-only and saving declarations unchanged', () => {
    render(<ModelReasoning model={{ id: 'custom' }} api="openai-responses" position={2} disabled t={key => en[key]} onChange={vi.fn()} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
  })
})
