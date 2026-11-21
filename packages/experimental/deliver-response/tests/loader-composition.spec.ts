/** Loader composition with recording adapters and a local Vertex endpoint. */
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import * as Delivery from '../src/index.ts'
import { APPROVAL_RESULT, CHECKLIST_SOURCE, DELIVER_RESPONSE, READ_REQUIREMENTS, READ_RESULT, REQUEST_APPROVAL } from '../src/protocol.ts'

const pluginPackage = '@deepseek-ai/dsh-experimental-deliver-response'
const workRequirements = 'Test requirement: include the result and its unit.'
const body = 'The result is **42 m**.'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  deliver = false

  async *stream(request: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.requests.push(request)
    if (!this.deliver) {
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'A plain-text response.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    yield { type: 'block-end', index: 0, block: {
      type: 'tool-call', id: ToolCallId('delivery'), name: DELIVER_RESPONSE, arguments: JSON.stringify({ body }),
    } }
    yield { type: 'block-end', index: 1, block: {
      type: 'tool-call', id: ToolCallId('ordinary'), name: 'echo', arguments: '{}',
    } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

async function boot(vertexURL?: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-deliver-response-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
  })
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['llm', LlmRuntime], ['session', SessionStore], ['session-projection', SessionProjectionRegistry],
    ['system-prompt', SystemPrompt], ['tools', ToolRuntime], ['agent', AgentRegistry], ['agent-loop', AgentLoop],
    [pluginPackage, Delivery],
  ])
  const config: Record<string, object> = { [pluginPackage]: { workRequirements } }
  if (vertexURL !== undefined) {
    const credentials = join(root, 'credentials.yaml')
    await writeFile(credentials, 'version: 1\nrefs:\n  DELIVERY_TEST_KEY: offline-key\n')
    modules.set('credentials', LocalCredentialProvider)
    modules.set('llm-pi-ai', LlmPiAi)
    config.credentials = { path: credentials, debounceMs: 10 }
    config['llm-pi-ai'] = { providers: { 'test-relay': {
      api: 'google-vertex', baseURL: vertexURL, apiKeyEnv: 'DELIVERY_TEST_KEY',
      retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: 'gemini-4-hydrogen' }],
    } } }
  }
  const internal: ModuleLoaderV2 = {
    version: 'v2', loadCache: new Map(),
    async import(specifier) {
      if (!modules.has(specifier)) throw new Error(`Unexpected fixture module: ${specifier}`)
      return modules.get(specifier)
    },
    register(): never { throw new Error('Unexpected module registration') },
    getOrCreateModuleJob(): never { throw new Error('Unexpected module job creation') },
    resolveSync(): never { throw new Error('Unexpected module resolution') },
    load(): never { throw new Error('Unexpected module loading') },
  }
  ctx.loader.internal = internal
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([...modules.keys()].map(name => ({
    name, ...name === pluginPackage ? { id: 'deliver-response' } : {},
    ...config[name] === undefined ? {} : { config: config[name] },
  }))))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.name === pluginPackage)
  if (entry?.fiber === undefined) throw new Error('Loader did not mount the response delivery plugin')
  const delivery = entry.fiber
  const adapter = new RecordingAdapter()
  if (vertexURL === undefined) ctx.llm.registerAdapter(['test-relay'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('delivery-test'), {
    provider: 'test-relay', model: vertexURL === undefined ? 'gemini-3-flash-preview' : 'gemini-4-hydrogen',
  })
  return { ctx, adapter, agent, delivery, entry }
}

async function submit(agent: Agent, text: string) {
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
  await agent.whenIdle()
}

function responses(request: GenerateOptions | undefined) {
  return request?.messages.filter(message => message.role === 'tool')
}

it('logs two local tool exchanges before provider dispatch, retains siblings, and unloads cleanly', async () => {
  const { ctx, adapter, agent, delivery, entry } = await boot()
  const ran: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'echo', description: 'Run an ordinary tool.', parameters: {},
    async execute() { ran.push('echo'); return [] },
  }))
  ctx.on('tools/pre-execute', async (exec, next) => { ran.push(exec.name); return next() })
  adapter.deliver = true
  await submit(agent, 'Measure the distance.')

  expect(adapter.requests).toHaveLength(1)
  const request = adapter.requests[0]
  expect(request?.tools?.map(tool => tool.name)).toEqual([DELIVER_RESPONSE, 'echo', READ_REQUIREMENTS, REQUEST_APPROVAL])
  expect(request?.tools?.find(tool => tool.name === READ_REQUIREMENTS)?.description).toContain(workRequirements)
  expect(JSON.stringify(request?.messages)).not.toContain(workRequirements)
  const history = request?.messages.filter(message => message.role !== 'system')
  expect(history?.map(message => [message.role, message.source?.kind])).toEqual([
    ['user', 'user'], ['user', CHECKLIST_SOURCE], ['assistant', 'model'], ['tool', 'tool'], ['assistant', 'model'], ['tool', 'tool'],
  ])
  const calls = history?.flatMap(message => message.content.filter(block => block.type === 'tool-call'))
  expect(calls?.map(call => [call.name, call.arguments])).toEqual([[READ_REQUIREMENTS, '{}'], [REQUEST_APPROVAL, '{}']])
  expect(responses(request)?.map(result => [result.toolCallId, result.content])).toEqual([
    [calls?.[0]?.id, [{ type: 'text', text: READ_RESULT }]],
    [calls?.[1]?.id, [{ type: 'text', text: APPROVAL_RESULT }]],
  ])
  expect(ran).toEqual([READ_REQUIREMENTS, REQUEST_APPROVAL, DELIVER_RESPONSE, 'echo', 'echo'])
  expect(agent.session.deriveMessages().at(-1)?.role).toBe('tool')
  const events = agent.session.snapshotEvents()
  expect(events.find(event => event.type === 'tool/result' && event.data.meta !== undefined)?.data).toMatchObject({ meta: { kind: 'deliver-response', body }, message: { isError: false } })
  expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })

  const edited = 'Test requirement: report the measurement uncertainty.'
  await entry.update({ config: { workRequirements: edited } })
  await ctx.loader.await()
  expect(entry.fiber).toBe(delivery)
  adapter.deliver = false
  agent.followup(createUserMessage({
    source: { kind: 'tool', callId: ToolCallId('queued-task') },
    content: [{ type: 'text', text: 'Confirm with ordinary text.' }],
  }))
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  expect(adapter.requests[1]?.tools?.find(tool => tool.name === READ_REQUIREMENTS)?.description).toContain(edited)
  expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain(edited)
  expect(adapter.requests[1]?.messages.filter(message => message.source?.kind === CHECKLIST_SOURCE)).toHaveLength(2)
  expect(agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'A plain-text response.' }])

  await delivery.dispose()
  await submit(agent, 'After unloading the plugin.')
  expect(adapter.requests).toHaveLength(3)
  expect(adapter.requests[2]?.tools?.map(tool => tool.name)).toEqual(['echo'])
  expect(adapter.requests[2]?.messages.filter(message => message.source?.kind === CHECKLIST_SOURCE)).toHaveLength(2)
})

it('does not turn a policy denial into approval and starts fresh after cancellation', async () => {
  const { ctx, adapter, agent } = await boot()
  const deny = ctx.on('tools/pre-execute', async (exec, next) => exec.name === READ_REQUIREMENTS
    ? { kind: 'deny', reason: 'Fixture policy denied the requirements read' } : next())
  await submit(agent, 'Request with restricted tools.')
  expect(adapter.requests).toHaveLength(1)
  expect(responses(adapter.requests[0])?.map(result => result.isError)).toEqual([true])
  deny()

  const cancel = ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name === REQUEST_APPROVAL) agent.cancel({ kind: 'user' })
    return next()
  })
  await submit(agent, 'Cancel before approval settles.')
  expect(adapter.requests).toHaveLength(1)
  cancel()
  await submit(agent, 'Start a new request.')
  expect(adapter.requests).toHaveLength(2)
  const lastResults = responses(adapter.requests[1])?.slice(-2)
  expect(lastResults?.map(result => result.isError)).toEqual([false, false])
  expect(adapter.requests[1]?.messages.filter(message => message.source?.kind === CHECKLIST_SOURCE)).toHaveLength(3)
})

interface VertexRequest {
  contents: {
    role: string
    parts: {
      thoughtSignature?: string
      functionCall?: { name: string }
      functionResponse?: { name: string }
    }[]
  }[]
  tools: { functionDeclarations: { name: string; description: string }[] }[]
  toolConfig?: { functionCallingConfig?: { mode?: string } }
}

it('sends signed prefills with AUTO tool choice through the real Vertex adapter', async () => {
  const requests: VertexRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as VertexRequest)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{
        functionCall: { name: DELIVER_RESPONSE, args: { body } }, thoughtSignature: 'c2ln',
      }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 } })}\n\n`)
    })
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
    server.closeAllConnections()
  }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing local Vertex test endpoint')
  const { ctx, agent } = await boot(`http://127.0.0.1:${address.port}/v1beta`)
  ctx.tools.register(defineContentToolFixture({
    name: 'echo', description: 'Run an ordinary tool.', parameters: {}, async execute() { return [] },
  }))
  await submit(agent, 'Return the measured distance.')
  expect(requests).toHaveLength(1)
  const request = requests[0]!
  const parts = request.contents.flatMap(content => content.parts)
  expect(parts.filter(part => part.functionCall).map(part => part.functionCall?.name)).toEqual([READ_REQUIREMENTS, REQUEST_APPROVAL])
  expect(parts.filter(part => part.functionResponse).map(part => part.functionResponse?.name))
    .toEqual([READ_REQUIREMENTS, REQUEST_APPROVAL])
  // Google's wire protocol requires this exact base64 validator-skip value for supplied calls.
  expect(parts.filter(part => part.functionCall).map(part => part.thoughtSignature)).toEqual([
    'c2tpcF90aG91Z2h0X3NpZ25hdHVyZV92YWxpZGF0b3I=', 'c2tpcF90aG91Z2h0X3NpZ25hdHVyZV92YWxpZGF0b3I=',
  ])
  const declarations = request.tools.flatMap(tool => tool.functionDeclarations)
  expect(declarations.map(tool => tool.name)).toEqual([DELIVER_RESPONSE, 'echo', READ_REQUIREMENTS, REQUEST_APPROVAL])
  expect(declarations.find(tool => tool.name === READ_REQUIREMENTS)?.description).toContain(workRequirements)
  expect(JSON.stringify(request.contents)).not.toContain(workRequirements)
  // Omission uses Google's AUTO default; neither ANY nor NONE may be forced.
  expect([undefined, 'AUTO']).toContain(request.toolConfig?.functionCallingConfig?.mode)
  expect(agent.session.snapshotEvents().find(event => event.type === 'tool/result' && event.data.meta !== undefined)?.data)
    .toMatchObject({ meta: { kind: 'deliver-response', body }, message: { isError: false } })
  expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
}, 30_000)
