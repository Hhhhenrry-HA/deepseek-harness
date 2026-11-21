/** Client registrations scoped to the optional Deliver Response bundle. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { SettingsFormModel, settingsTextField } from '@deepseek-ai/dsh-client-ui-primitives'
import { DeliverResponseSettings, WORK_REQUIREMENTS, type WorkRequirements } from './DeliverResponseSettings.tsx'
import { DeliveredReply } from './DeliveredReply.tsx'
import { DeliveryRow } from './DeliveryRow.tsx'
import { DELIVERY, deliveryDefinition } from './delivery-definition.ts'
import { en, NS, zh } from './locales.ts'

/** Client services for settings and tool presentation. */
export const inject = ['configForms', 'locale', 'slots', 'uiConversation']

/**
 * Mount settings and delivery presentation while the optional client entry is active.
 * @param ctx - Client plugin context owning both slot contributions.
 */
export function apply(ctx: Context): void {
  const scope = ctx.configForms.get<WorkRequirements>('deliver-response')
  const form = new SettingsFormModel(scope, [{
    ...settingsTextField(WORK_REQUIREMENTS),
    parse: text => ({ kind: 'set', value: text }),
  }])
  ctx.effect(() => () => { form.dispose() })
  const state = form.bind(() => ({ ...form.shell(), requirements: form.field(WORK_REQUIREMENTS) }))
  const settings = { hooks: { requirementsForm: state }, ...form.actions() }
  ctx.effect(() => ctx.locale.register(NS, { en, zh }))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-experimental-deliver-response-bundle', locale: NS,
    inject: () => settings,
  }, DeliverResponseSettings))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'deliver_response', locale: NS,
  }, DeliveryRow))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: DELIVERY, locale: NS,
  }, DeliveredReply))
  ctx.uiConversation.events.register(deliveryDefinition)
}
