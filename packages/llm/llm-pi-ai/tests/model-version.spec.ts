/** Served-model name matching for Google `modelVersion`. */
import { expect, it } from 'vitest'
import { sameModel, servedModelCheck } from '../src/model-version.ts'

it('treats dated, alias, and resource-prefixed names as the requested model', () => {
  expect(sameModel('gemini-2.5-flash-preview', 'gemini-2.5-flash-preview-05-20')).toBe(true)
  expect(sameModel('gemini-4-argon-a', 'gemini-4-argon')).toBe(true)
  expect(sameModel('gemini-4-argon', 'models/Gemini-4-Argon')).toBe(true)
})

it('treats any other model as a substitute', () => {
  expect(sameModel('gemini-4-argon', '3.1-flash-lite-05-2026')).toBe(false)
  expect(sameModel('gemini-4-carbon', 'gemini-4.0-flash')).toBe(false)
})

it('checks only Google APIs and ignores chunks without modelVersion', () => {
  expect(servedModelCheck('openai-completions', 'gpt-5')).toBeUndefined()
  const check = servedModelCheck('google-generative-ai', 'gemini-4-argon')!
  check.onProviderStreamEvent({ candidates: [] })
  check.onProviderStreamEvent(null)
  expect(() => { check.assertServed() }).not.toThrow()
  check.onProviderStreamEvent({ modelVersion: '3.1-flash-lite-05-2026' })
  check.onProviderStreamEvent({ modelVersion: 'gemini-4-argon' })
  expect(() => { check.assertServed() }).toThrow(expect.objectContaining({ code: 'MODEL_MISMATCH' }))
})
