/** Locale-owned copy for the requirements editor and delivery activity. */
import { settingsSaveEn, settingsSaveZh } from '@deepseek-ai/dsh-client-ui-primitives'

/** Dictionary namespace for both contributions. */
export const NS = 'deliverResponse'

/** English dictionary and locale key source. */
export const en = {
  ...settingsSaveEn,
  saveReasonMissing: 'Check your changes before saving again.',
  requirements: 'Additional work requirements',
  overridden: 'Overridden',
  reset: 'Reset to default',
  discard: 'Discard changes',
  unavailable: 'Work requirements are unavailable.',
  readOnly: 'These settings are read-only.',
  save: 'Save',
  saving: 'Saving…',
  pending: 'Delivering response',
  failed: 'Response was not delivered',
  stopped: 'Response delivery was stopped',
  delivered: 'Response delivered',
  bodyUnavailable: 'Delivered response is unavailable',
  inspect: 'Inspect',
}

/** Simplified Chinese dictionary. */
export const zh: Record<keyof typeof en, string> = {
  ...settingsSaveZh,
  saveReasonMissing: '请检查修改后再保存',
  requirements: '额外工作要求',
  overridden: '已覆盖',
  reset: '恢复默认',
  discard: '放弃修改',
  unavailable: '暂时无法读取工作要求',
  readOnly: '这些设置为只读',
  save: '保存',
  saving: '保存中…',
  pending: '正在提交回复',
  failed: '回复提交失败',
  stopped: '回复提交已停止',
  delivered: '回复已提交',
  bodyUnavailable: '无法显示已提交的回复',
  inspect: '查看详情',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    [NS]: keyof typeof en
  }
}
