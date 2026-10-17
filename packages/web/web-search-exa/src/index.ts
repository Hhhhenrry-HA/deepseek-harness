/**
 * Exa-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-exa
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { WebError } from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  ExaSearchProvider,
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
} from './provider.ts'

export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
  EXA_DEFAULT_SEARCH_TYPE,
  EXA_PROVIDER_ID,
  ExaSearchProvider,
} from './provider.ts'
export type { ExaSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Live settings resolved for each search; literal keys stay out of settings responses. */
export interface Config {
  /** Literal API key; prefer the credential reference. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved per search; defaults to `EXA_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL: Volatile<string>
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType: Volatile<'auto' | 'keyword' | 'neural'>
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults: Volatile<number | undefined>
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult: Volatile<number>
}

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default('EXA_API_KEY').volatile(),
  baseURL: z.string().default(EXA_DEFAULT_BASE_URL).volatile(),
  searchType: z.union(['auto', 'keyword', 'neural'] as const).default(EXA_DEFAULT_SEARCH_TYPE).volatile(),
  numResults: z.number().step(1).min(1).volatile(),
  highlightsPerResult: z.number().step(1).min(1).default(EXA_DEFAULT_HIGHLIGHTS_PER_RESULT).volatile(),
})

/** Register the Exa search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider({
    id: EXA_PROVIDER_ID,
    // Credentials resolve asynchronously per operation, including after a GUI save.
    available: () => true,
    async search(request, signal) {
      const ref = credentialRef(config.apiKeyEnv.get())
      const credentials = ctx.get('credentials')
      const apiKey = config.apiKey.get()
        ?? (credentials === undefined
          ? launchEnvironmentOf(ctx).get(ref)?.value
          : (await credentials.resolve(ref))?.value)
      if (apiKey === undefined || apiKey.length === 0) {
        throw new WebError('EXA search is not configured. Open Plugins > EXA Web Search and save an API key, then retry.', 'WEB_PROVIDER_UNAVAILABLE')
      }
      const numResults = config.numResults.get()
      return new ExaSearchProvider({
        apiKey,
        baseURL: config.baseURL.get(),
        searchType: config.searchType.get(),
        highlightsPerResult: config.highlightsPerResult.get(),
        ...numResults === undefined ? {} : { numResults },
      }).search(request, signal)
    },
  })
}
