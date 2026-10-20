import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '../src/index.ts'
import type { BasicCompactionConfig } from '../src/index.ts'
import CompactionModelSelectionConfig from '../src/model-selection-settings.ts'
import type { CompactionModelSelectionSettings, Config } from '../src/model-selection-settings.ts'
import { SelectionAdapter } from './model-selection-fixture.ts'

const SIGNAL = new AbortController().signal
const HISTORY = 'older conversation history '.repeat(1_500)

async function harness(config: BasicCompactionConfig = {}, withSettings = true) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  const preference: CompactionModelSelectionSettings = { model: null, reasoningEffort: null }
  const references: Config = {
    model: { get: () => preference.model },
    reasoningEffort: { get: () => preference.reasoningEffort },
  }
  const settings = withSettings ? new CompactionModelSelectionConfig(ctx, references) : undefined
  const main = new SelectionAdapter()
  const configured = new SelectionAdapter()
  const selected = new SelectionAdapter()
  ctx.llm.registerAdapter(['main'], main)
  ctx.llm.registerAdapter(['configured'], configured)
  ctx.llm.registerAdapter(['selected'], selected)
  await ctx.plugin(BasicCompactionEngine, {
    auto: false,
    thresholdRatio: 0.5,
    retainTokens: 0,
    headroomTokens: 0,
    maxTokens: 32,
    ...config,
  })
  const agent = await ctx.agentLoop.create(SessionId('live-summary-selection'), {
    provider: 'main', model: 'conversation', maxTokens: 128, reasoningEffort: ReasoningEffortId('high'),
  })
  return { ctx, agent, main, configured, selected, preference, settings }
}

async function turn(agent: Agent): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: HISTORY }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('live compaction model selection', () => {
  it.each(['automatic', 'manual', 'region'] as const)(
    'samples model and effort changes for the next %s compaction in the same session',
    async (mode) => {
      const { ctx, agent, main, configured, selected, preference } = await harness({
        auto: mode === 'automatic',
        summarizationProvider: 'configured',
        summarizationModel: 'summary',
      })
      let compactRegion = false
      if (mode === 'region') {
        ctx.on('agent/pre-step', async (_event, next) => {
          if (compactRegion) {
            const nodes = agent.session.surface.nodes
            await ctx.compaction.compactRegion(nodes[1]!, nodes.at(-2)!, agent, SIGNAL)
          }
          return next()
        })
      }
      await turn(agent)
      const originalOptions = structuredClone(agent.options)
      const originalHeader = structuredClone(agent.session.requestHeader())
      const originalConfig = structuredClone((ctx.compaction as BasicCompactionEngine).config)
      const choices = [
        { model: { provider: 'selected', model: 'alpha' }, reasoningEffort: 'high' },
        { model: { provider: 'selected', model: 'alpha' }, reasoningEffort: null },
        { model: { provider: 'selected', model: 'beta' }, reasoningEffort: 'high' },
        { model: null, reasoningEffort: 'high' },
      ] satisfies CompactionModelSelectionSettings[]

      for (const [index, choice] of choices.entries()) {
        Object.assign(preference, choice)
        if (mode === 'manual') {
          await expect(ctx.compaction.compactNow(agent, SIGNAL)).resolves.not.toBeNull()
        } else {
          compactRegion = true
          await turn(agent)
        }
        const expected = choice.model ?? { provider: 'configured', model: 'summary' }
        const explicitEffort = choice.model === null ? null : choice.reasoningEffort
        const request = choice.model === null ? configured.requests.at(-1) : selected.requests.at(-1)
        expect(request).toMatchObject({
          ...expected, maxTokens: 32, purpose: 'compaction',
          reasoningEffort: ReasoningEffortId(explicitEffort ?? 'low'),
          sessionId: agent.session.id,
        })
        const summaries = agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')
        expect(summaries).toHaveLength(index + 1)
        expect(summaries.at(-1)?.data).toMatchObject(expected)
        if (choice.model === null) expect(summaries.at(-1)?.data).not.toHaveProperty('reasoningEffort')
        else expect(summaries.at(-1)?.data.reasoningEffort).toBe(ReasoningEffortId(explicitEffort ?? 'low'))
        expect(agent.options).toEqual(originalOptions)
        expect(agent.session.requestHeader()).toEqual(originalHeader)
        expect((ctx.compaction as BasicCompactionEngine).config).toEqual(originalConfig)
        if (mode === 'manual' && index < choices.length - 1) await turn(agent)
      }
      expect(selected.requests).toHaveLength(3)
      expect(configured.requests).toHaveLength(1)
      expect(main.requests.every(request => request.provider === 'main'
        && request.model === 'conversation' && request.maxTokens === 128
        && request.reasoningEffort === ReasoningEffortId('high'))).toBe(true)
    },
  )

  it.each([
    { model: { provider: 'unregistered', model: 'summary' }, reasoningEffort: null, code: 'NO_ADAPTER' },
    { model: { provider: 'selected', model: 'missing' }, reasoningEffort: null, code: 'MODEL_NOT_FOUND' },
    { model: { provider: 'selected', model: 'alpha' }, reasoningEffort: 'unsupported', code: 'UNSUPPORTED_REASONING_EFFORT' },
  ])('rejects an unavailable selected route or effort without a conversation fallback: $code', async (choice) => {
    const { ctx, agent, preference, main, configured, selected } = await harness({
      summarizationProvider: 'configured', summarizationModel: 'summary',
    })
    await turn(agent)
    Object.assign(preference, choice)
    const before = [...agent.session.surface.nodes]
    const header = structuredClone(agent.session.requestHeader())
    const options = structuredClone(agent.options)

    await expect(ctx.compaction.compactNow(agent, SIGNAL)).rejects.toMatchObject({
      code: 'summary', cause: { code: choice.code },
    })

    expect(main.requests).toHaveLength(1)
    expect(configured.requests).toHaveLength(0)
    expect(selected.requests).toHaveLength(0)
    expect(agent.session.surface.nodes).toEqual(before)
    expect(agent.session.requestHeader()).toEqual(header)
    expect(agent.options).toEqual(options)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')).toEqual([])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/end')).toHaveLength(1)
  })

  it('rejects middleware rerouting of an explicitly selected summary without dispatching the conversation model', async () => {
    const { ctx, agent, preference, main, selected } = await harness()
    await turn(agent)
    preference.model = { provider: 'selected', model: 'alpha' }
    preference.reasoningEffort = 'low'
    ctx.on('llm/stream', (options, next) => {
      if (options.purpose === 'compaction') {
        options.provider = 'main'
        options.model = 'conversation'
      }
      return next()
    })
    const before = [...agent.session.surface.nodes]

    await expect(ctx.compaction.compactNow(agent, SIGNAL)).rejects.toMatchObject({
      code: 'summary', cause: { code: 'INVALID_PREPARED_CALL' },
    })

    expect(main.requests).toHaveLength(1)
    expect(selected.requests).toHaveLength(0)
    expect(agent.session.surface.nodes).toEqual(before)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')).toEqual([])
  })

  it.each([false, true])('preserves configured routing and conversation-following defaults when settings are absent: %s', async (configuredRoute) => {
    const { ctx, agent, main, configured } = await harness(configuredRoute
      ? { summarizationProvider: 'configured', summarizationModel: 'summary' } : {}, false)
    await turn(agent)
    expect(ctx.get('compactionModelSelection')).toBeUndefined()

    await expect(ctx.compaction.compactNow(agent, SIGNAL)).resolves.not.toBeNull()

    const request = configuredRoute ? configured.requests[0] : main.requests[1]
    expect(request).toMatchObject({
      provider: configuredRoute ? 'configured' : 'main',
      model: configuredRoute ? 'summary' : 'conversation',
      reasoningEffort: ReasoningEffortId('low'), purpose: 'compaction', maxTokens: 32,
    })
    expect(agent.options.reasoningEffort).toBe(ReasoningEffortId('high'))
    expect(agent.session.requestHeader()?.config.reasoningEffort).toBe(ReasoningEffortId('high'))
  })
})

describe('compaction model selection settings', () => {
  it('defaults to backend routing and rejects incomplete routes or empty effort ids at load', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(CompactionModelSelectionConfig)
    expect(ctx.compactionModelSelection.current()).toEqual({ model: null, reasoningEffort: null })
    for (const config of [
      { model: { provider: '', model: 'summary' } },
      { model: { provider: 'selected', model: '' } },
      { model: { provider: 'selected' } },
      { reasoningEffort: '' },
    ]) {
      expect(() => CompactionModelSelectionConfig.Config(config)).toThrow()
    }
  })

  it('returns detached per-operation snapshots from the live references and ignores effort in follow mode', async () => {
    const { preference, settings } = await harness()
    preference.model = { provider: 'selected', model: 'alpha' }
    preference.reasoningEffort = 'high'
    const snapshot = settings!.current()
    preference.model.model = 'beta'
    preference.reasoningEffort = null
    expect(snapshot).toEqual({ model: { provider: 'selected', model: 'alpha' }, reasoningEffort: 'high' })
    expect(settings!.current()).toEqual({ model: { provider: 'selected', model: 'beta' }, reasoningEffort: null })
    preference.model = null
    preference.reasoningEffort = 'high'
    expect(settings!.current()).toEqual({ model: null, reasoningEffort: null })
  })

  it('removes the optional preference service on disposal', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const fiber = ctx.plugin(CompactionModelSelectionConfig, { model: { provider: 'selected', model: 'alpha' } })
    await fiber
    expect(ctx.get('compactionModelSelection')?.current().model).toEqual({ provider: 'selected', model: 'alpha' })
    await fiber.dispose()
    expect(ctx.get('compactionModelSelection')).toBeUndefined()
  })
})
