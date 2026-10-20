import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import CompactionModelSelectionConfig from '../src/model-selection-settings.ts'
import { SelectionAdapter } from './model-selection-fixture.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-token-meter-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.builtins.loopDependencies = { apply: mountAgentLoopTestDependencies }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-compaction-basic/model-selection-settings', CompactionModelSelectionConfig],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-token-meter', TokenMeter],
    ['@deepseek-ai/dsh-compaction-tool-result-pruner', ToolResultPruner],
    ['@deepseek-ai/dsh-compaction-basic', BasicCompactionEngine],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads omitted summary preferences as backend-following defaults', async () => {
    const loaded = await loadYaml([
      '- id: compaction-model-selection-settings',
      "  name: '@deepseek-ai/dsh-compaction-basic/model-selection-settings'",
    ])
    expect(loaded.get('compactionModelSelection')?.current()).toEqual({ model: null, reasoningEffort: null })
  })

  it('applies live YAML summary-model edits to the same running session without changing its conversation route', async () => {
    const loaded = await loadYaml([
      '- name: cordis:loopDependencies',
      "- name: '@deepseek-ai/dsh-agent-loop'",
      '  config:',
      '    agents: []',
      "- name: '@deepseek-ai/dsh-token-meter'",
      '- id: compaction-model-selection-settings',
      "  name: '@deepseek-ai/dsh-compaction-basic/model-selection-settings'",
      '  config:',
      '    model: { provider: selected, model: alpha }',
      '    reasoningEffort: high',
      "- name: '@deepseek-ai/dsh-compaction-basic'",
      '  config:',
      '    auto: false',
      '    headroomTokens: 0',
      '    maxTokens: 32',
    ])
    const main = new SelectionAdapter()
    const selected = new SelectionAdapter()
    loaded.llm.registerAdapter(['main'], main)
    loaded.llm.registerAdapter(['selected'], selected)
    const agent = await loaded.agentLoop.create(SessionId('loader-summary-selection'), {
      provider: 'main', model: 'conversation', reasoningEffort: ReasoningEffortId('high'), maxTokens: 128,
    })
    const preference = loaded.get('compactionModelSelection')
    const entry = [...loaded.loader.entries()].find(row => row.options.id === 'compaction-model-selection-settings')!
    const fiberUid = entry.fiber?.uid
    const signal = new AbortController().signal
    for (const [index, config] of [
      { model: { provider: 'selected', model: 'alpha' }, reasoningEffort: 'high' },
      { model: { provider: 'selected', model: 'beta' }, reasoningEffort: null },
      {},
    ].entries()) {
      if (index > 0) await entry.update({ config })
      expect(entry.fiber?.uid).toBe(fiberUid)
      expect(preference?.current()).toEqual(index === 0
        ? { model: { provider: 'selected', model: 'alpha' }, reasoningEffort: 'high' }
        : index === 1 ? { model: { provider: 'selected', model: 'beta' }, reasoningEffort: null }
          : { model: null, reasoningEffort: null })
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'older conversation history '.repeat(1_500) }], source: { kind: 'user' },
      }))
      await agent.whenIdle()
      const beforeHeader = structuredClone(agent.session.requestHeader())
      const beforeOptions = structuredClone(agent.options)
      await expect(loaded.compaction.compactNow(agent, signal)).resolves.not.toBeNull()
      const summary = agent.session.snapshotEvents().findLast(event => event.type === 'compaction/summary')
      expect(summary?.data).toMatchObject({
        provider: index < 2 ? 'selected' : 'main',
        model: index === 0 ? 'alpha' : index === 1 ? 'beta' : 'conversation',
      })
      if (index < 2) expect(summary?.data.reasoningEffort).toBe(ReasoningEffortId(index === 0 ? 'high' : 'low'))
      else expect(summary?.data).not.toHaveProperty('reasoningEffort')
      expect(agent.session.requestHeader()).toEqual(beforeHeader)
      expect(agent.options).toEqual(beforeOptions)
    }
    expect(selected.requests.map(request => [request.model, request.reasoningEffort])).toEqual([
      ['alpha', 'high'], ['beta', 'low'],
    ])
    expect(main.requests.filter(request => request.purpose === 'compaction')).toHaveLength(1)
    expect(main.requests.filter(request => request.purpose !== 'compaction')).toHaveLength(3)
    await entry.fiber!.dispose()
    expect(loaded.get('compactionModelSelection')).toBeUndefined()
  })

  it('loads the shipped token-meter, pruning, and compaction-basic YAML order', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-compaction-tool-result-pruner'",
      '  config:',
      '    thresholdChars: 100',
      '    headChars: 20',
      '    tailChars: 10',
      "- name: '@deepseek-ai/dsh-compaction-basic'",
      '  config:',
      '    thresholdRatio: 0.5',
      '    headroomTokens: 4000',
      '    modelPolicies:',
      '      - provider: mock',
      '        model: small',
      '        headroomTokens: 0',
      '        maxTokens: 32',
      '    retainRatio: 0.125',
      '    auto: false',
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.get('toolResultPruner')).toBeInstanceOf(ToolResultPruner)
    expect(loaded.get('compaction')).toBeInstanceOf(BasicCompactionEngine)
    expect((loaded.compaction as BasicCompactionEngine).config).toMatchObject({
      thresholdRatio: 0.5,
      headroomTokens: 4000,
      modelPolicies: [{ provider: 'mock', model: 'small', headroomTokens: 0, maxTokens: 32 }],
      retainRatio: 0.125,
      auto: false,
    })
  })

  it('rejects stale token-meter config after Schemastery normalization', async () => {
    context = new Context()
    await context.plugin(SessionProjectionRegistry)
    await expect(context.plugin(TokenMeter, {
      contextWindow: 4096,
    } as never)).rejects.toThrow(/TokenMeterConfig: unknown key "contextWindow"/)
  })

  it('rejects stale compaction-basic config after Schemastery normalization', async () => {
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(SessionStore)
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(BasicCompactionEngine, {
      models: { legacy: { thresholdRatio: 0.5 } },
    } as never)).rejects.toThrow(/BasicCompactionConfig: unknown key "models"/)
  })

  it('rejects a capacity-independent merged ratio conflict during plugin load', async () => {
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(SessionStore)
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(BasicCompactionEngine, {
      retainRatio: 0.2,
      modelPolicies: [{
        provider: 'test-provider',
        model: 'test-model',
        thresholdRatio: 0.1,
      }],
    })).rejects.toThrow(/modelPolicies\[0\]: retainRatio \(0.2\).*thresholdRatio \(0.1\)/)
  })

  it('rejects an incomplete model-policy summarization pair during plugin load', async () => {
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(SessionStore)
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(BasicCompactionEngine, {
      summarizationProvider: 'default-provider',
      summarizationModel: 'default-model',
      modelPolicies: [{
        provider: 'test-provider',
        model: 'test-model',
        summarizationModel: '',
      }],
    })).rejects.toThrow(/modelPolicies\[0\].*must be set together/)
  })
})
