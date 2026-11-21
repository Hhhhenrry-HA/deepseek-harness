/** Staged editing of the requirements sent with the agent's reading tool. */
import { useId } from 'react'
import {
  Button, SettingsForm, Tag, type SettingsFieldState, type SettingsFormActions, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './DeliverResponseSettings.module.css'

/** String field in the Deliver Response Host configuration section. */
export const WORK_REQUIREMENTS = 'workRequirements'

/** Accepted requirements mirrored from the Host. */
export interface WorkRequirements {
  [WORK_REQUIREMENTS]: string
}

interface RequirementsFormState extends SettingsFormShell {
  requirements: SettingsFieldState
}

/** Observable draft and its staged edit actions, bound by the slot renderer. */
export interface DeliverResponseSettingsInjected extends SettingsFormActions {
  hooks: { requirementsForm: HostObservable<RequirementsFormState> }
}

/** Slot inputs for the bundle detail form. */
export type DeliverResponseSettingsProps = PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<typeof NS> & InjectFace<DeliverResponseSettingsInjected>

/**
 * Display the effective Host value and stage edits until the user saves.
 * @param props - Locale, draft state, and edit actions from the slot registration.
 * @returns The requirements editor with save feedback and reset/discard controls.
 */
export function DeliverResponseSettings({ t, useRequirementsForm, edit, resetField, save, discard }: DeliverResponseSettingsProps) {
  const id = useId()
  const state = useRequirementsForm(value => value)
  const { requirements } = state
  const disabled = !state.writable || state.saving
  return <SettingsForm state={state} onSave={save} onDiscard={discard} labels={{
    unavailable: t('unavailable'), readOnly: t('readOnly'), save: t('save'), saving: t('saving'),
    saveFailed: t('saveFailed'), saveSucceeded: t('saveSucceeded'), saveReasonMissing: t('saveReasonMissing'),
  }}>
    <div className={css.field}>
      <div className={css.header}>
        <label htmlFor={id}>{t('requirements')}</label>
        {requirements.overridden && <>
          <Tag tone="neutral">{t('overridden')}</Tag>
          <Button size="sm" disabled={disabled} onClick={() => { resetField(WORK_REQUIREMENTS) }}>{t('reset')}</Button>
        </>}
      </div>
      <textarea id={id} rows={5} className={css.input} value={requirements.text} disabled={disabled}
        onChange={(event) => { edit(WORK_REQUIREMENTS, event.target.value) }} />
      {state.dirty && <div className={css.actions}>
        <Button size="sm" disabled={state.saving} onClick={discard}>{t('discard')}</Button>
      </div>}
    </div>
  </SettingsForm>
}
