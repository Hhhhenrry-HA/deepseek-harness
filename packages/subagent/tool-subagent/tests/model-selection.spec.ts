/** Tier routing is enforced before child creation through tools and direct orchestration. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as fork from '../../subagent-fork-in-process/src/index.ts'
import AgentPreset from '../../../preset/agent-preset/src/index.ts'
import SubagentModelSelectionConfig from '../src/model-selection-settings.ts'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as tool from '../src/index.ts'
import { callSubagent, modelSelectionSetupAgent, ownContext, setup, text } from './harness.ts'

const REASONING = {
  efforts: [
    { id: ReasoningEffortId('low'), name: 'Low' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
  defaultEffort: ReasoningEffortId('low'),
}

describe('subagent model tiers', () => {
  it('uses the default tier for omitted starts and takes high from the root rather than a default-tier parent', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({
      provider: 'mock', withModelSelection: true,
      parentAgentOptions: { provider: 'alpha', model: 'main-model', reasoningEffort: ReasoningEffortId('high') },
    }, { onStart: (request) => { requests.push(request) } })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const root = modelSelectionSetupAgent(ctx)
    for (const model_tier of [undefined, null, 'default', 'high']) {
      const result = await callSubagent(ctx, { description: 'scoped task', prompt: 'work', ...model_tier === undefined ? {} : { model_tier } })
      if (result.isError) throw new Error(text(result))
    }
    expect(requests.map(request => request.agentOptions)).toEqual([
      ...Array.from({ length: 3 }, () => ({ provider: 'alpha', model: 'child-model', reasoningEffort: 'low' })),
      { provider: 'alpha', model: 'main-model', reasoningEffort: 'high' },
    ])
    const nested = await ctx.agents.create({
      sessionId: SessionId('medium-parent'),
      meta: { origin: 'subagent', parentSession: root.id },
      agentOptions: { provider: 'alpha', model: 'child-model', reasoningEffort: ReasoningEffortId('low'), subagentDepth: 1 },
    })
    for (const modelTier of [undefined, 'high'] as const) {
      const child = await ctx.subagents.startActivation({
        provider: 'mock', label: 'workflow entry',
        request: {
          parent: nested.agent, prompt: [{ type: 'text', text: 'work' }], maxDepth: 3,
          agentOptions: { provider: 'alpha', model: 'forced-expensive-model', reasoningEffort: ReasoningEffortId('high') },
          ...modelTier === undefined ? {} : { modelTier },
        },
        signal: new AbortController().signal, delivery: 'caller',
      })
      await child.result
      await child.dispose()
    }
    expect(requests.slice(-2).map(request => request.agentOptions)).toEqual([
      { provider: 'alpha', model: 'child-model', reasoningEffort: 'low' },
      { provider: 'alpha', model: 'main-model', reasoningEffort: 'high' },
    ])
  })

  it('boots tiered spawn and fork from Loader configuration and runs the selected model with its own default effort', async () => {
    const ctx = ownContext(new Context())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(Loader)
    Object.assign(ctx.loader.builtins, {
      include: Include, modelSettings: SubagentModelSelectionConfig, subagents: SubagentRuntime,
      spawn, fork, presets: AgentPresets, preset: AgentPreset, delegate: tool,
    })
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: new URL('./fixtures/model-tiers.yml', import.meta.url).href },
    })
    for (const entry of ctx.loader.entries()) await entry.fiber?.await()
    const adapter = new MockAdapter(Array.from({ length: 4 }, () => textResponse('child finished')))
    ctx.llm.registerAdapter(['alpha'], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId('loader-main'),
      agentOptions: { provider: 'alpha', model: 'child-model', reasoningEffort: ReasoningEffortId('high') },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'tiered') },
    })
    for (const provider of ['spawn', 'fork']) {
      const name = provider === 'spawn' ? 'subagent' : 'subagent_fork'
      const schema = ctx.tools.schemas(handle.agent).find(schema => schema.name === name)!
      expect(schema.parameters.properties).toHaveProperty('model_tier')
      expect(schema.parameters.properties).not.toHaveProperty('provider')
      const activation = await ctx.subagents.startActivation({
        provider, label: 'scoped work',
        request: { parent: handle.agent, prompt: [{ type: 'text', text: 'work' }] },
        signal: new AbortController().signal, delivery: 'caller',
      })
      expect((await activation.result).stopReason).toBe('completed')
      await activation.dispose()
    }
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    expect(adapter.requests.map(request => ({ provider: request.provider, model: request.model }))).toEqual([
      { provider: 'alpha', model: 'child-model' }, { provider: 'alpha', model: 'child-model' },
    ])
    expect(adapter.requests.map(request => request.reasoningEffort)).toEqual([undefined, undefined])
  })

  it('does not create or fall back to an expensive child on missing, unsupported, or failing default routes', async () => {
    const started = vi.fn()
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { onStart: started })
    const missing = await callSubagent(ctx, { description: 'work', prompt: 'work' })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('no adapter registered')
    const adapter = new MockAdapter([])
    ctx.llm.registerAdapter(['alpha'], adapter)
    vi.spyOn(adapter, 'resolveModel').mockRejectedValue(new Error('selected route unavailable'))
    const failed = await callSubagent(ctx, { description: 'work', prompt: 'work' })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('selected route unavailable')
    const invalid = await callSubagent(ctx, { description: 'work', prompt: 'work', model_tier: 'max' })
    expect(invalid.isError).toBe(true)
    const parent = modelSelectionSetupAgent(ctx)
    parent.session.append('subagent/model-tier-policy', { enabled: true, mediumModel: null, reasoningEffort: null })
    const unconfigured = await callSubagent(ctx, { description: 'work', prompt: 'work' })
    expect(unconfigured.isError).toBe(true)
    expect(started).not.toHaveBeenCalled()
  })
})
