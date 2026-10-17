/** Per-model reasoning declarations for pi-ai routes. */
import type { ReactNode } from 'react'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

const PRESETS = {
  openai: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  claude: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
} as const

interface ModelReasoningProps {
  model: DeepSeekModelDraft
  api: string | undefined
  position: number
  disabled: boolean
  t: (key: ModelsKey) => string
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Edit reasoning support without replacing other model metadata or custom wire mappings.
 * @param props - model declaration, route protocol, and row replacement action.
 * @returns the reasoning capability selector.
 */
export function ModelReasoning({ model, api, position, disabled, t, onChange }: ModelReasoningProps): ReactNode {
  const efforts = model['reasoningEfforts']
  const preset = Object.entries(PRESETS).find(([, values]) =>
    typeof efforts === 'object' && efforts !== null
    && Object.keys(efforts).length === Object.keys(values).length
    && Object.entries(values).every(([key, value]) => Reflect.get(efforts, key) === value))?.[0]
  const selected = efforts === undefined ? 'inherit' : efforts === false ? 'disabled' : preset ?? 'custom'
  const protocol = typeof model['api'] === 'string' ? model['api'] : api
  return (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{t('modelReasoning')}</span>
      <select
        className={`${styles['input']} ${styles['selectInput']}`}
        aria-label={`${t('modelReasoning')} ${String(position)}`}
        value={selected}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value
          const next = { ...model }
          const compat = model['compat']
          if (typeof compat === 'object' && compat !== null && !Array.isArray(compat)) {
            const remaining = { ...compat }
            Reflect.deleteProperty(remaining, 'forceAdaptiveThinking')
            if (Object.keys(remaining).length === 0) Reflect.deleteProperty(next, 'compat')
            else next['compat'] = remaining
          }
          if (value === 'inherit') Reflect.deleteProperty(next, 'reasoningEfforts')
          else if (value === 'disabled') next['reasoningEfforts'] = false
          else if (value === 'openai' || value === 'claude') {
            next['reasoningEfforts'] = { ...PRESETS[value] }
            if (value === 'claude') {
              const remaining = next['compat']
              next['compat'] = {
                ...typeof remaining === 'object' && remaining !== null ? remaining : {},
                forceAdaptiveThinking: true,
              }
            }
          }
          onChange(next)
        }}
      >
        <option value="inherit">{t('modelReasoningInherit')}</option>
        <option value="disabled">{t('modelReasoningDisabled')}</option>
        {protocol !== 'anthropic-messages' || selected === 'openai'
          ? <option value="openai">{t('modelReasoningOpenAi')}</option> : null}
        {protocol === undefined || protocol === 'anthropic-messages' || selected === 'claude'
          ? <option value="claude">{t('modelReasoningClaude')}</option> : null}
        {selected === 'custom' ? <option value="custom" disabled>{t('modelReasoningCustom')}</option> : null}
      </select>
    </label>
  )
}
