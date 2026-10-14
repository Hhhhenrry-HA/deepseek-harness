import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import { SETTINGS_ID } from '../constants.ts'
import { ExaCardController, type ExaCardFace } from './controller.ts'
import { en, zh, type LocaleKey } from './locales.ts'

const LOCALE = 'settings.exaSearch'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.exaSearch': LocaleKey }
}

type CardProps = PropsRuntime<'plugins.item'> & PropsLocale<typeof LOCALE> & InjectFace<ExaCardFace>
function ExaCard(props: CardProps) {
  const { t } = props
  const state = props.useExaCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const statusLabel = state.keyStatus === 'loading' ? t('apiKeyLoading')
    : state.keyStatus === 'error' ? t('credentialFailed')
      : state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')
  return <SettingsForm state={state} onSave={props.save} onDiscard={props.discard} labels={{
    unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'),
    save: t('save'), saving: t('saving'),
  }}>
    <SettingsSecretField id="exa-search-key" label={t('apiKey')} hint={t('apiKeyHint')}
      disabled={!state.apiKeyWritable} text={state.apiKey.text} configured={state.apiKeyConfigured}
      stateLabel={statusLabel} onEdit={text => props.edit('apiKey', text)} />
    {state.keyStatus === 'error' && <div role="alert">
      <Button onClick={props.retryCredential}>{t('retry')}</Button>
    </div>}
    <SettingsValueField id="exa-search-endpoint" label={t('baseUrl')} hint={t('baseUrlHint')}
      overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
      disabled={!state.writable} {...state.baseURL}
      onEdit={text => props.edit('baseURL', text)} onReset={() => props.resetField('baseURL')} />
  </SettingsForm>
}

export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(LOCALE)
  ctx.effect(() => ctx.locale.register(LOCALE, { zh, en }), 'exa-search: locale')
  const card = new ExaCardController(ctx.configForms.get(SETTINGS_ID), ctx)
  ctx.effect(() => () => card.dispose(), 'exa-search: form')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', ref => card.refreshCredential(ref)), 'exa-search: key state')
  ctx.effect(() => ctx.configForms.whileServed([SETTINGS_ID], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: SETTINGS_ID, order: 20, label: () => t('title'), locale: LOCALE,
    inject: () => card.inject(),
  }, ExaCard))), 'exa-search: settings page')
}
