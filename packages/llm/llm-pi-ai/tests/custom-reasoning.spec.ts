/** Custom-model levels reach both model metadata and the provider request. */
import { afterEach, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { anthropicTextEvents, closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(closeMockServers)

it.each(['openai-completions', 'anthropic-messages'] as const)('sends every declared custom-model effort over %s', async (api) => {
  const levels = api === 'anthropic-messages' ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high', 'xhigh', 'max']
  const server = await mockServer(levels.map(() => ({ events: api === 'anthropic-messages' ? anthropicTextEvents : textEvents })))
  const profiles = resolveProfiles({
    gateway: {
      api, baseURL: server.url,
      models: [{
        id: 'custom-model',
        reasoningEfforts: Object.fromEntries(levels.map(level => [level, level])),
        ...api === 'anthropic-messages' ? { compat: { forceAdaptiveThinking: true } } : {},
      }],
    },
  })
  const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve('test-key'), auth: memoryAuth() })
  await expect(adapter.resolveModel('gateway', 'custom-model')).resolves.toMatchObject({
    reasoning: { efforts: levels.map(id => ({ id })) },
  })
  for (const [index, level] of levels.entries()) {
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'gateway', model: 'custom-model', messages: [], reasoningEffort: ReasoningEffortId(level),
    })) chunks.push(chunk)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }))
    expect(server.requests[index]).toMatchObject(api === 'anthropic-messages'
      ? { thinking: { type: 'adaptive' }, output_config: { effort: level } }
      : { reasoning_effort: level })
  }
})
