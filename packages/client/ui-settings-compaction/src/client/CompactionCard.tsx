/** Plugins-page summary-model form, rendered entirely from injected snapshots. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { ModelRouteFields, SettingsForm, modelRouteCandidates } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CompactionSettingsFace } from './controller.ts'
import css from './CompactionCard.module.css'

/** Framework-derived page inputs. */
export type CompactionCardProps = PropsRuntime<'plugins.item'> & PropsLocale<'settings.compaction'>
  & InjectFace<CompactionSettingsFace>

/**
 * Render the preference, directory feedback, and shared save/discard footer.
 * @param props - Locale, form/catalogue snapshots, and staged-edit callbacks.
 * @returns The plugin summary or editable summary-model preference.
 */
export function CompactionCard(props: CompactionCardProps) {
  const { t } = props
  const form = props.useCompactionForm(snapshot => snapshot)
  const catalog = props.useCompactionCatalog(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const candidates = modelRouteCandidates(catalog.groups, form.retained, new Set([form.selected]))
  return (
    <SettingsForm state={form} onSave={props.save} onDiscard={props.discard} labels={{
      unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'),
      saveSucceeded: t('saveSucceeded'), saveReasonMissing: t('saveReasonMissing'), save: t('save'), saving: t('saving'),
    }}>
      <div className={css.section}>
        <p className={css.hint}>{t('applies')}</p>
        {catalog.status === 'loading' ? <p className={css.hint} role="status">{t('loading')}</p> : null}
        {catalog.status === 'error' ? (
          <div className={css.error} role="alert">
            <span>{t('loadFailed')}</span>
            <button type="button" disabled={form.saving} onClick={props.retryCatalog}>{t('retry')}</button>
          </div>
        ) : null}
        {catalog.partial ? <p className={css.hint}>{t('partial')}</p> : null}
        {catalog.status === 'ready' && catalog.groups.every(group => group.models.length === 0)
          ? <p className={css.hint}>{t('empty')}</p> : null}
        <ModelRouteFields candidates={candidates} reasoningEffort={form.reasoningEffort}
          disabled={!form.writable || form.saving} defaultChoice={{ label: t('follow'), selected: form.selected === '' }}
          labels={{ title: t('model'), unavailable: t('unavailableModel'), unavailableGroup: t('unavailableGroup'),
            effort: t('effort'), defaultEffort: t('defaultEffort') }} onSelect={props.selectModel} onEffort={props.setEffort} />
        {form.selected === '' ? <p className={css.hint}>{t('configured')}</p> : null}
      </div>
    </SettingsForm>
  )
}
