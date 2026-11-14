/**
 * Endpoint handling for hand-declared Google routes.
 *
 * Both Google protocols take an API prefix that may omit its version path:
 * `https://relay.example` is served as `https://relay.example/v1beta`, while a
 * prefix that already names a version (`/v1`, `/v1beta`, `/v1alpha`) is used
 * as written. Model requests and model listing derive their URL from the same
 * prefix through {@link googleApiBase}.
 *
 * The `google-vertex` protocol on a hand-declared route is a key-authenticated
 * relay: requests use the Vertex request body and `x-goog-api-key`, addressed
 * as `{prefix}/models/{model}:streamGenerateContent` rather than under a
 * Google Cloud project and location. Requests offering tools set
 * `streamFunctionCallArguments`, so tool arguments stream as `partialArgs`.
 *
 * @module dsh-llm-pi-ai/google-route
 */

import type { Api, Model, ProviderStreams, SimpleStreamOptions, StreamOptions } from '@earendil-works/pi-ai'
import { lazyStream } from '@earendil-works/pi-ai/api/lazy'

/** Version path appended to a Google API prefix that names none. */
const DEFAULT_GOOGLE_API_VERSION = 'v1beta'

/** One path segment naming a Google API version. */
const API_VERSION_SEGMENT = /^v\d+(?:(?:alpha|beta)\d*)?$/

/**
 * The Google API prefix requests and listings are built on.
 * @param baseURL - the route's configured endpoint.
 * @returns the endpoint without trailing slashes, with `/v1beta` appended when
 *   no path segment names an API version.
 */
export function googleApiBase(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base.split('/').some(segment => API_VERSION_SEGMENT.test(segment))
    ? base
    : `${base}/${DEFAULT_GOOGLE_API_VERSION}`
}

/** The route's model with its endpoint resolved to the versioned Google prefix. */
function versioned(model: Model<Api>): Model<Api> {
  return { ...model, baseUrl: googleApiBase(model.baseUrl) }
}

/**
 * Serve a Gemini native route with a versioned endpoint.
 * @param streams - pi-ai's Gemini native implementation.
 * @returns the implementation for hand-declared Gemini native routes.
 */
export function geminiRoute(streams: ProviderStreams): ProviderStreams {
  return {
    stream: (model, context, options) => streams.stream(versioned(model), context, options),
    streamSimple: (model, context, options) => streams.streamSimple(versioned(model), context, options),
  }
}

/** The request fields the relay rewrites in pi-ai's GenerateContent parameters. */
interface RelayParams {
  model: string
  config?: {
    tools?: readonly { functionDeclarations?: readonly unknown[] }[]
    toolConfig?: { functionCallingConfig?: { mode?: string; streamFunctionCallArguments?: boolean } }
  }
}

/**
 * Address the model as `models/{id}` so the relay URL omits the project and
 * location path, and ask for streamed function-call arguments whenever the
 * request declares functions the model may call.
 */
function relayPayload(params: RelayParams): RelayParams {
  const model = params.model.startsWith('models/') ? params.model : `models/${params.model}`
  const config = params.config
  const calling = config?.toolConfig?.functionCallingConfig
  const declares = config?.tools?.some(tool => (tool.functionDeclarations?.length ?? 0) > 0) === true
  if (config === undefined || !declares || calling?.mode === 'NONE') return { ...params, model }
  return {
    ...params,
    model,
    config: {
      ...config,
      toolConfig: { ...config.toolConfig, functionCallingConfig: { ...calling, streamFunctionCallArguments: true } },
    },
  }
}

/** Options for one relay request: the relay addressing runs before any caller payload hook. */
function relayOptions<O extends StreamOptions>(options: O): O {
  const callerHook = options.onPayload
  return {
    ...options,
    onPayload: async (payload, model) => {
      // pi-ai's Vertex implementation passes its GenerateContent parameters here.
      const relayed = relayPayload(payload as RelayParams)
      return await callerHook?.(relayed, model) ?? relayed
    },
  }
}

/**
 * Serve a key-authenticated Vertex relay route.
 * @param streams - pi-ai's Vertex implementation.
 * @returns the implementation for hand-declared `google-vertex` routes. A
 *   request without an API key fails its stream before any network request,
 *   because pi-ai would otherwise fall back to Google Cloud project credentials.
 */
export function vertexRelayRoute(streams: ProviderStreams): ProviderStreams {
  const call = <O extends StreamOptions | SimpleStreamOptions>(
    run: (model: Model<Api>, options: O) => ReturnType<ProviderStreams['stream']>,
    model: Model<Api>,
    options: O | undefined,
  ): ReturnType<ProviderStreams['stream']> => {
    if (options?.apiKey === undefined || options.apiKey.trim() === '') {
      return lazyStream(model, () => Promise.reject(new Error(
        `Vertex relay route "${model.provider}" needs an API key; set the route's API key`,
      )))
    }
    return run(versioned(model), relayOptions(options))
  }
  return {
    stream: (model, context, options) => call((m, o) => streams.stream(m, context, o), model, options),
    streamSimple: (model, context, options) => call((m, o) => streams.streamSimple(m, context, o), model, options),
  }
}
