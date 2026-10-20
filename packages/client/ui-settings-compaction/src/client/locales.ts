/** Locale-owned copy for the context-compaction preference page. */
import { settingsSaveEn, settingsSaveZh } from '@deepseek-ai/dsh-client-ui-primitives'

/** English labels for summary-model settings. */
export const en = {
  ...settingsSaveEn,
  title: 'Context compaction',
  description: 'Choose the model and reasoning effort used to summarize conversation history.',
  applies: 'Applies to the next automatic compaction or /compact, including existing conversations. The conversation model stays unchanged.',
  model: 'Summary model',
  follow: 'Default (follow conversation model)',
  configured: 'A summary route configured by the deployment takes precedence over the conversation model in default mode.',
  effort: 'Reasoning effort',
  defaultEffort: 'Model default',
  unavailableModel: 'Currently unavailable',
  unavailableGroup: 'Saved but currently unavailable',
  loading: 'Loading models…',
  loadFailed: 'Models could not be loaded.',
  retry: 'Retry',
  partial: 'Some providers could not be loaded. Saved choices remain visible.',
  empty: 'No provider currently advertises a model.',
  unavailable: 'Context compaction settings are not available in this deployment.',
  readOnly: 'This deployment stores settings read-only.',
  save: 'Save',
  saving: 'Saving…',
}

/** Keys bound to the settings.compaction locale namespace. */
export type CompactionLocaleKey = keyof typeof en

/** Chinese labels with the same keys as the English dictionary. */
export const zh: Record<CompactionLocaleKey, string> = {
  ...settingsSaveZh,
  title: '上下文压缩',
  description: '选择总结会话历史所用的模型和思考强度。',
  applies: '保存后，下一次自动压缩或 /compact 生效，已有会话也适用。会话模型不变。',
  model: '总结模型',
  follow: '默认（跟随会话模型）',
  configured: '默认模式下，如果部署已指定总结模型，则使用部署配置的模型。',
  effort: '思考强度',
  defaultEffort: '模型默认',
  unavailableModel: '当前不可用',
  unavailableGroup: '已保存但当前不可用',
  loading: '正在加载模型…',
  loadFailed: '无法加载模型。',
  retry: '重试',
  partial: '部分提供方暂时无法加载，已保存的选择仍会显示。',
  empty: '当前没有提供方公布模型。',
  unavailable: '当前部署未提供上下文压缩设置。',
  readOnly: '本部署的设置为只读。',
  save: '保存',
  saving: '保存中…',
}
