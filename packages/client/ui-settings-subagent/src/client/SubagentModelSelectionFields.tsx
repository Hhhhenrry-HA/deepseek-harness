/** User control for model-selectable subagent delegation in new sessions. */

import { ModelRouteFields, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SubagentModelSelectionCardFace,
  SubagentModelSelectionCardState,
} from './subagent-model-selection-card-controller.ts'
import css from './SubagentModelSelectionFields.module.css'

/** Plain model state and callbacks supplied by the owning Subagent card. */
export type SubagentModelSelectionFieldsProps = PropsLocale<'settings.subagent'>
  & Pick<SubagentModelSelectionCardFace, 'toggleEnabled' | 'toggleModel' | 'setReasoningEffort' | 'retryCatalog'>
  & { state: SubagentModelSelectionCardState }

/**
 * Render the default-off preference and its exact adapter-route choices.
 * @param props - locale copy, the card snapshot, and its toggle action.
 * @returns the model permission and route choices inside the shared card.
 */
export function SubagentModelSelectionFields(props: SubagentModelSelectionFieldsProps) {
  const { t, state } = props
  return (
    <>
      <div className={css.permission}>
        <div className={css.toggleRow}>
          <span className={css.toggleLabel}>{t('subagentModelSelectionToggle')}</span>
          <Switch
            checked={state.enabled}
            label={t('subagentModelSelectionToggle')}
            disabled={!state.writable || state.saving}
            onChange={props.toggleEnabled}
          />
        </div>
        <p className={css.hint}>{t('subagentModelSelectionChoose')}</p>
      </div>
      {state.enabled
        ? (
          <div className={css.selection}>
            {state.catalogStatus === 'loading'
              ? <p className={css.notice} role="status">{t('subagentModelSelectionLoading')}</p>
              : null}
            {state.catalogStatus === 'error'
              ? (
                <div className={css.catalogError} role="alert">
                  <span>{t('subagentModelSelectionLoadFailed')}</span>
                  <button type="button" disabled={state.saving} onClick={props.retryCatalog}>
                    {t('subagentModelSelectionRetry')}
                  </button>
                </div>
              )
              : null}
            {state.catalogPartial
              ? <p className={css.notice}>{t('subagentModelSelectionPartial')}</p>
              : null}
            {state.candidates.length > 0
              ? (
                <ModelRouteFields candidates={state.candidates} reasoningEffort={state.reasoningEffort}
                  disabled={!state.writable || state.saving}
                  labels={{
                    title: t('subagentModelSelectionAllowed'), unavailable: t('subagentModelSelectionUnavailable'),
                    unavailableGroup: t('subagentModelSelectionUnavailableGroup'),
                    effort: t('subagentModelSelectionEffort'), defaultEffort: t('subagentModelSelectionDefaultEffort'),
                  }}
                  onSelect={(key) => { if (key !== null) props.toggleModel(key) }} onEffort={props.setReasoningEffort} />
              )
              : state.catalogStatus === 'ready'
                ? <p className={css.notice}>{t('subagentModelSelectionEmpty')}</p>
                : null}
            <div className={css.high}><span>{t('subagentModelSelectionHigh')}</span><span>{t('subagentModelSelectionFollowMain')}</span></div>
            {state.invalid ? <p className={css.invalid}>{t(state.needsSelection ? 'subagentModelSelectionReselect' : 'subagentModelSelectionRequired')}</p> : null}
          </div>
        )
        : null}
      {state.conflicted
        ? <p className={css.conflict} role="status">{t('subagentModelSelectionConflict')}</p>
        : null}
    </>
  )
}
