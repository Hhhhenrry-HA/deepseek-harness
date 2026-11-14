/**
 * Served-model verification for Google GenerateContent streams.
 *
 * Google reports the model that produced each response chunk in
 * `GenerateContentResponse.modelVersion`. Upstream routing can substitute a
 * different model without failing the request; this module detects that so the
 * adapter can stop the stream before the substitute's output enters the
 * conversation.
 *
 * @module dsh-llm-pi-ai/model-version
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Api } from '@earendil-works/pi-ai'

/** Failure code for a response produced by a model other than the requested one. */
export const MODEL_MISMATCH_CODE = 'MODEL_MISMATCH'

const VERIFIED_APIS: ReadonlySet<Api> = new Set<Api>(['google-generative-ai', 'google-vertex'])

/** Normalize a Google model name: drop the resource prefix and compare case-insensitively. */
function normalize(name: string): string {
  return name.replace(/^(?:.*\/)?models\//, '').toLowerCase()
}

/**
 * Whether the reported model is the requested one. Either name may contain the
 * other, so dated suffixes (`gemini-2.5-flash-preview-05-20`) and gateway alias
 * suffixes (`gemini-4-argon-a` reported as `gemini-4-argon`) still match.
 * @param requested - model id DSH sent.
 * @param reported - `modelVersion` from the response.
 * @returns true when the names identify the same model.
 */
export function sameModel(requested: string, reported: string): boolean {
  const a = normalize(requested)
  const b = normalize(reported)
  return a.includes(b) || b.includes(a)
}

/** Records the first mismatched `modelVersion` seen on one stream. */
export interface ServedModelCheck {
  /** pi-ai `onProviderStreamEvent` hook; reads each raw response chunk. */
  onProviderStreamEvent: (data: unknown) => void
  /** Throw when a chunk reported a different model; call before forwarding output. */
  assertServed: () => void
}

/**
 * Create the served-model check for one stream, or undefined when the API does
 * not report a served model.
 * @param api - pi-ai API of the requested model.
 * @param requested - model id DSH sent.
 * @returns the per-stream check, or undefined for unverified APIs.
 */
export function servedModelCheck(api: Api, requested: string): ServedModelCheck | undefined {
  if (!VERIFIED_APIS.has(api)) return undefined
  let mismatch: string | undefined
  return {
    onProviderStreamEvent: (data) => {
      if (mismatch !== undefined || typeof data !== 'object' || data === null) return
      const reported = (data as { modelVersion?: unknown }).modelVersion
      if (typeof reported === 'string' && reported !== '' && !sameModel(requested, reported)) mismatch = reported
    },
    assertServed: () => {
      if (mismatch === undefined) return
      throw new LlmError(`Requested model "${requested}", but the response came from "${mismatch}".`, MODEL_MISMATCH_CODE)
    },
  }
}
