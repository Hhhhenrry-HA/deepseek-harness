/**
 * Model-name defaults for the wire switches of a custom `openai-completions`
 * route, which pi-ai otherwise derives from the provider id and base URL
 * alone. Only a route the installed catalog does not describe uses them, as
 * the lowest layer: catalog facts and explicit route or model `compat` win.
 *
 * @module dsh-llm-pi-ai/openai-compat
 */

import type { OpenAICompletionsCompat } from '@earendil-works/pi-ai'

/** The switches this module may default; a subset of pi-ai's completions compat. */
type NameCompat = Pick<
  OpenAICompletionsCompat,
  | 'supportsStore'
  | 'supportsDeveloperRole'
  | 'maxTokensField'
  | 'requiresReasoningContentOnAssistantMessages'
>

/** Switches for a gateway that takes `max_tokens`, no `store`, and the `system` role. */
const GATEWAY_WIRE: NameCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: 'max_tokens',
}

/** DeepSeek tool replay requires `reasoning_content`; the native transport resolves its thinking dialect. */
const DEEPSEEK: NameCompat = {
  ...GATEWAY_WIRE,
  requiresReasoningContentOnAssistantMessages: true,
}

/**
 * Resolve the default `openai-completions` switches for one model id.
 *
 * Only the id decides: a relay prefix such as `vendor/` is ignored, an id
 * naming both families resolves to DeepSeek, and other families get none.
 * @param modelId - the model id sent on the wire.
 * @returns a fresh object holding the family's switches, empty for any other model.
 */
export function openAiCompletionsNameCompat(modelId: string): NameCompat {
  const id = modelId.toLowerCase()
  if (id.includes('deepseek')) return { ...DEEPSEEK }
  if (id.includes('gemini')) return { ...GATEWAY_WIRE }
  return {}
}
