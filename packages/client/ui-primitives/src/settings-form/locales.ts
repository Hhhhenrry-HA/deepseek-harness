/** Shared save-feedback dictionaries composed into settings-page locales. */
export const settingsSaveEn = {
  saveSucceeded: 'Saved successfully',
  saveFailed: 'Save failed: ',
  saveReasonMissing: 'No error reason was returned',
}

/** Simplified Chinese save feedback. */
export const settingsSaveZh: typeof settingsSaveEn = {
  saveSucceeded: '保存成功',
  saveFailed: '保存失败：',
  saveReasonMissing: '未返回失败原因',
}

/** Locale keys shared by settings-save feedback. */
export type SettingsSaveLocaleKey = keyof typeof settingsSaveEn
