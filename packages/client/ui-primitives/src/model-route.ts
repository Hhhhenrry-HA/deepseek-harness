/** Exact model-route choices shared by settings pages. */
export interface ModelRoute {
  provider: string
  model: string
}

/** Adapter metadata needed by a model preference editor. */
export interface ModelRouteGroup {
  id: string
  name: string
  models: readonly {
    id: string
    name: string
    reasoning?: { efforts: readonly { id: string; name: string }[] }
  }[]
}

/** One live or retained route rendered by the shared selector. */
export interface ModelRouteCandidate extends ModelRoute {
  key: string
  providerName: string
  modelName: string
  available: boolean
  selected: boolean
  efforts: readonly { id: string; name: string }[]
}

/**
 * Identify one exact route without parsing its provider or model names.
 * @param route - The exact adapter route.
 * @returns A lookup key local to the model selector.
 */
export function modelRouteKey(route: ModelRoute): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Join the live directory with stored or staged choices missing from that directory.
 * @param groups - Available provider groups.
 * @param retained - Routes to keep visible even when unavailable.
 * @param selected - Keys selected by the editor.
 * @returns Live candidates followed by unavailable retained routes.
 */
export function modelRouteCandidates(
  groups: readonly ModelRouteGroup[],
  retained: readonly ModelRoute[],
  selected: ReadonlySet<string>,
): ModelRouteCandidate[] {
  const remaining = new Map(retained.map(route => [modelRouteKey(route), route]))
  const candidates = groups.flatMap(group => group.models.map((model): ModelRouteCandidate => {
    const route = { provider: group.id, model: model.id }
    const key = modelRouteKey(route)
    remaining.delete(key)
    return {
      ...route, key, providerName: group.name, modelName: model.name,
      available: true, selected: selected.has(key), efforts: model.reasoning?.efforts ?? [],
    }
  }))
  for (const route of remaining.values()) {
    const key = modelRouteKey(route)
    candidates.push({
      ...route, key, providerName: route.provider, modelName: route.model,
      available: false, selected: selected.has(key), efforts: [],
    })
  }
  return candidates
}
