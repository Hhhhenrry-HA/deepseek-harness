import { describe, expect, it } from 'vitest'
import { modelRouteCandidates, modelRouteKey } from '../src/model-route.ts'

describe('model route candidates', () => {
  it('distinguishes exact provider/model IDs even when route display strings match', () => {
    const first = { provider: 'provider/part', model: 'model' }
    const second = { provider: 'provider', model: 'part/model' }
    expect(modelRouteKey(first)).not.toBe(modelRouteKey(second))
    expect(modelRouteKey({ ...first })).toBe(modelRouteKey(first))
  })

  it('uses live metadata for retained routes, deduplicates unavailable choices, and selects only exact keys', () => {
    const live = { provider: 'alpha', model: 'shared-id' }
    const saved = { provider: 'legacy', model: 'saved-id' }
    const draft = { provider: 'beta', model: 'shared-id' }
    const efforts = [{ id: 'adaptive-id', name: 'Adaptive' }]
    const candidates = modelRouteCandidates([
      { id: 'alpha', name: 'Alpha directory label', models: [{ id: live.model, name: 'Live model label', reasoning: { efforts } }] },
      { id: 'gamma', name: 'Gamma directory label', models: [{ id: 'plain-id', name: 'Plain model label' }] },
    ], [live, saved, draft, saved], new Set([modelRouteKey(draft)]))

    expect(candidates).toHaveLength(4)
    expect(candidates[0]).toMatchObject({ ...live, available: true, selected: false, providerName: 'Alpha directory label', modelName: 'Live model label', efforts })
    expect(candidates[1]).toMatchObject({ provider: 'gamma', available: true, selected: false, efforts: [] })
    expect(candidates[2]).toMatchObject({
      ...saved, available: false, selected: false, providerName: saved.provider, modelName: saved.model, efforts: [],
    })
    expect(candidates[3]).toMatchObject({ ...draft, available: false, selected: true, efforts: [] })
    expect(candidates.filter(candidate => candidate.selected).map(candidate => candidate.key)).toEqual([modelRouteKey(draft)])
  })
})
