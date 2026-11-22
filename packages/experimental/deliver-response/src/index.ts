/** Opt-in native reply delivery using the ordinary agent and tool lifecycle. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { defineTool, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { preludeProjection, streamPrelude } from './prelude.ts'
export type {} from './prelude.ts'
import {
  APPROVAL_DESCRIPTION, APPROVAL_RESULT, CHECKLIST, CHECKLIST_SOURCE, DEFAULT_WORK_REQUIREMENTS,
  DELIVER_RESPONSE, DELIVERY_DESCRIPTION, DELIVERY_RESULT, READ_DESCRIPTION, READ_REQUIREMENTS,
  READ_RESULT, REQUEST_APPROVAL, SILENT_EFFORT, SYSTEM_INSTRUCTION,
} from './protocol.ts'

export const name = 'deliver-response'
export const inject = ['agents', 'llm', 'sessionProjections', 'systemPrompt', 'tools']

/** Editable configuration for the delivery requirements. */
export interface Config {
  /** Text included only in the work requirements tool description. */
  workRequirements: Volatile<string>
}

export const Config = z.object({
  workRequirements: z.string().default(DEFAULT_WORK_REQUIREMENTS).volatile(),
})

function confirmationTool(name: string, description: string, text: string) {
  return defineTool({
    name, description, parameters: {},
    output: { schema: { type: 'boolean', const: true }, render: () => [{ type: 'text', text }] },
    execute: () => Promise.resolve(true as const),
  })
}

/**
 * Register the delivery tools, checklist admission, and local prelude stream.
 * @param ctx - the plugin's Cordis scope, which owns all registrations.
 * @param config - the live work requirements setting.
 */
export function apply(ctx: Context, config: Config): void {
  const read = {
    ...confirmationTool(READ_REQUIREMENTS, READ_DESCRIPTION, READ_RESULT),
    get description() { return `${READ_DESCRIPTION}\n\n${config.workRequirements.get()}` },
  }
  const approval = confirmationTool(REQUEST_APPROVAL, APPROVAL_DESCRIPTION, APPROVAL_RESULT)
  const delivery = defineTool({
    name: DELIVER_RESPONSE,
    description: DELIVERY_DESCRIPTION,
    parameters: { body: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: () => [{ type: 'text', text: DELIVERY_RESULT }],
      presentationMeta: (_args, body) => ({ kind: name, body }),
    },
    execute({ body }, exec) {
      exec.concludeTurn()
      return Promise.resolve(body)
    },
  })
  const definitions = [read, approval, delivery]

  ctx.inject(['settings'], scope => scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber)))
  ctx.sessionProjections.register(preludeProjection)
  for (const definition of definitions) ctx.tools.register(definition)
  ctx.tools.guard((exec) => {
    if (exec.parent === undefined) return undefined
    const own = definitions.find(definition => definition.name === exec.name)
    return own !== undefined && ctx.tools.get(exec.name, exec.agent) === own
      ? 'Response delivery tools require native tool calling.' : undefined
  })

  function availableTo(agent?: Agent): boolean {
    return ctx.tools.get(RUN_CODE_NAME, agent) === undefined
      && definitions.every(definition => ctx.tools.get(definition.name, agent) === definition)
  }

  ctx.systemPrompt.section({
    name: `${name}:effort`,
    order: ctx.systemPrompt.getSectionOrder('HARNESS_IDENTITY') - 1,
    text: ({ agent }) => availableTo(agent) ? SILENT_EFFORT : '',
  })
  ctx.systemPrompt.section({
    name,
    order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    text: ({ agent }) => availableTo(agent) ? SYSTEM_INSTRUCTION : '',
  })

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || decision.messages.length === 0) return decision
    if (!availableTo(agent) || ctx.sessionProjections.stateOf(agent.session, preludeProjection.key) !== null) return decision
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        source: { kind: CHECKLIST_SOURCE, form: 'instructions' },
        content: [{ type: 'text', text: CHECKLIST }],
      })],
    }
  }, { prepend: true })

  ctx.on('llm/stream', (request, next) => {
    if (!isAgentLoopRequest(request) || request.signal?.aborted) return next()
    const agent = ctx.agents.requireInitiator()
    const state = ctx.sessionProjections.stateOf(agent.session, preludeProjection.key)
    if (state === null || state === undefined || state.stage === 'done') return next()
    if (!definitions.every(({ name }) => request.tools?.some(tool => tool.name === name))) return next()
    return streamPrelude(state.checklistId, state.stage)
  }, { prepend: true })
}
