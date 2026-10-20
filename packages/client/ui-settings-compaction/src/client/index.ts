/** Context-compaction settings in the Plugins page. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CompactionCard } from './CompactionCard.tsx'
import { CompactionSettingsController } from './controller.ts'
import { en, zh, type CompactionLocaleKey } from './locales.ts'

export type { CompactionCardProps } from './CompactionCard.tsx'
export type { CompactionSettingsFace, CompactionSettings } from './controller.ts'
export type { CompactionLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Summary-model preference labels. */
    'settings.compaction': CompactionLocaleKey
  }
}

export const inject = ['slots', 'locale', 'remote', 'remote.session', 'configForms']

/**
 * Register the page only while the Host serves its summary preference.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  const namespace = 'compaction-model-selection-settings'
  const locale = 'settings.compaction'
  const t = ctx.locale.bind(locale)
  ctx.effect(() => ctx.locale.register(locale, { en, zh }), 'ui-settings-compaction: dictionaries')
  const controller = new CompactionSettingsController(ctx.configForms.get(namespace), ctx)
  const face = controller.inject()
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-compaction: controller')
  ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => { void controller.refreshCatalog() }), 'ui-settings-compaction: adapters')
  ctx.effect(() => ctx.remote.$on('settings/document-updated', () => { void controller.refreshCatalog() }), 'ui-settings-compaction: settings')
  ctx.effect(() => ctx.on('connection/reset', () => { controller.resetConnection() }), 'ui-settings-compaction: connection')
  ctx.effect(() => ctx.configForms.whileServed([namespace], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'compaction', order: 11,
    label: () => t('title'), locale, inject: () => face,
  }, CompactionCard))), 'ui-settings-compaction: page')
}
