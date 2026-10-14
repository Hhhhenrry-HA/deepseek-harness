import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  ExaSearchProvider,
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-exa'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_API_KEY_REF, EXA_SETUP_REQUIRED, SETTINGS_ID } from './constants.ts'

export { DEFAULT_API_KEY_REF, SETTINGS_ID } from './constants.ts'
export const name = SETTINGS_ID
export const inject = ['web', 'credentials']

/** Only non-secret settings persist; each operation resolves its current key. */
export interface Config {
  apiKeyEnv: Volatile<string>
  baseURL: Volatile<string>
}

export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_REF).volatile(),
  baseURL: z.string().default(EXA_DEFAULT_BASE_URL).volatile(),
})

export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider({
    id: EXA_PROVIDER_ID,
    // The credential service is mounted. Key resolution is asynchronous and
    // deliberately per operation rather than a cached secret/availability bit.
    available: () => true,
    async search(request, signal) {
      const baseURL = config.baseURL.get()
      const credential = await ctx.credentials.resolve(credentialRef(config.apiKeyEnv.get()))
      if (credential === undefined || credential.value.length === 0) {
        throw new WebError(EXA_SETUP_REQUIRED, 'WEB_PROVIDER_UNAVAILABLE')
      }
      return new ExaSearchProvider({
        apiKey: credential.value,
        baseURL,
        searchType: EXA_DEFAULT_SEARCH_TYPE,
        highlightsPerResult: EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
      }).search(request, signal)
    },
  })
}
