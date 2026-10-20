/** Single-model delegation settings and enforcement shared by every child-start entry. */
import type { Volatile } from '@deepseek-ai/cordis'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { parentAgentOptionsForDelegation, SubagentError } from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AllowedModelRouteSchema, assertAllowedModelRoutes, type AllowedModelRoute } from './model-selection.ts'
import {
  subagentModelSelectionPolicy, subagentModelSelectionProjectionDefinition,
  subagentModelTierProjectionDefinition, type SubagentModelTierPolicy,
} from './model-selection-state.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-owned default/high delegation policy. */
    subagentModelSelection: SubagentModelSelectionConfig
  }
}

/** Persisted single-model preference. */
export type SubagentModelSelectionSettings = SubagentModelTierPolicy

/** Deployment values; old allowlists are read only while upgrading 0.2.6 settings. */
export interface Config {
  enabled: Volatile<boolean>
  mediumModel: Volatile<AllowedModelRoute | null>
  reasoningEffort: Volatile<string | null>
  /** Compatibility: released 0.2.6 documents; removed from the user layer on the next save. */
  allowedModels: Volatile<AllowedModelRoute[]>
}

const policyErrors = {
  defaultMissing: 'The default-tier model is not configured. Ask the user to select one and start a new conversation.',
  mainMissing: 'The main agent is unavailable; the high-tier child was not started.',
  routeMissing: 'The main agent has no resolved model; the high-tier child was not started.',
}

/** Owns saved model settings, session snapshots, and pre-start route enforcement. */
export class SubagentModelSelectionConfig extends Service {
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    mediumModel: z.union([AllowedModelRouteSchema, z.const(null)]).default(null).volatile(),
    reasoningEffort: z.union([z.string().min(1), z.const(null)]).default(null).volatile(),
    allowedModels: z.array(AllowedModelRouteSchema).default([]).volatile().hidden(),
  })

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'subagentModelSelection')
    ctx.inject(['sessionProjections'], (projections) => {
      projections.sessionProjections.register(subagentModelSelectionProjectionDefinition)
      projections.sessionProjections.register(subagentModelTierProjectionDefinition)
    })
    ctx.inject(['subagents', 'sessionProjections'], (runtime) => {
      runtime.on('subagent/prepare-start', async (_requested, next) => {
        const spec = await next()
        const policy = this.forSession(spec.request.parent.session)
        if (!policy.enabled) return spec
        const tier = spec.request.modelTier ?? 'default'
        const main = tier === 'high' ? this.mainAgent(spec.request.parent) : undefined
        const mainOptions = main === undefined ? undefined : parentAgentOptionsForDelegation(main)
        const route = tier === 'default' ? policy.mediumModel : mainOptions
        if (route?.provider === undefined || route.model === undefined) {
          throw new SubagentError(tier === 'default' ? policyErrors.defaultMissing : policyErrors.routeMissing, 'MODEL_NOT_CONFIGURED')
        }
        const effort = tier === 'default' ? policy.reasoningEffort : mainOptions?.reasoningEffort
        const { reasoningEffort: _requestedEffort, ...configured } = spec.request.agentOptions ?? {}
        const requestedOptions = {
          ...configured,
          provider: route.provider,
          model: route.model,
          ...effort == null ? {} : { reasoningEffort: ReasoningEffortId(effort) },
        }
        const llm = runtime.get('llm')
        if (llm === undefined) throw new SubagentError('Cannot resolve the child model: the llm service is unavailable.', 'MODEL_NOT_CONFIGURED')
        const agentOptions = { ...requestedOptions, ...await llm.resolveCallConfig(requestedOptions, spec.signal) }
        spec.signal.throwIfAborted()
        return { ...spec, request: { ...spec.request, agentOptions, inheritReasoningEffort: false } }
      })
    })
  }

  /**
   * Read the current configuration, converting a released single-entry allowlist at this boundary.
   * @returns The enabled state, single default route, and optional reasoning effort.
   */
  current(): SubagentModelSelectionSettings {
    const oldRoutes = this.config.allowedModels.get()
    assertAllowedModelRoutes(oldRoutes)
    const selected = this.config.mediumModel.get()
      ?? (oldRoutes.length === 1 ? oldRoutes[0] ?? null : null)
    return {
      enabled: this.config.enabled.get(),
      mediumModel: selected === null ? null : { ...selected },
      reasoningEffort: this.config.reasoningEffort.get() ?? null,
    }
  }

  /**
   * Read or capture one Session's policy; children inherit it and restored sessions keep it.
   * @param session - target Session before its delegation definition is published.
   * @returns the pinned default model, effort, and enabled state.
   */
  forSession(session: Session): SubagentModelTierPolicy {
    const projections = this.ctx.get('sessionProjections')
    if (projections === undefined) throw new Error('subagent model policy requires session projections')
    const saved = projections.stateOf(session, 'subagentModelTierPolicy')
    if (saved != null) return saved
    const oldRoutes = subagentModelSelectionPolicy(projections, session)
    let policy: SubagentModelTierPolicy
    if (oldRoutes !== undefined) {
      // Compatibility: 0.2.6 Session allowlists; publish a current single-model snapshot once.
      policy = { enabled: true, mediumModel: oldRoutes.length === 1 ? oldRoutes[0] ?? null : null, reasoningEffort: null }
    } else if (session.header.origin === 'subagent' && session.header.parentSession !== undefined) {
      const parent = this.ctx.get('sessions')?.get(session.header.parentSession)
      if (parent === undefined) throw new SubagentError(policyErrors.mainMissing, 'PARENT_UNAVAILABLE')
      policy = this.forSession(parent)
    } else {
      const fresh = session.firstLiveSeq === 0
        // oxlint-disable-next-line typescript/no-deprecated -- Detect a released restore at its composition boundary.
        && session.eventAt(SessionSeq(0))?.type !== 'session/end-seed'
      policy = fresh ? this.current() : { enabled: false, mediumModel: null, reasoningEffort: null }
    }
    session.append('subagent/model-tier-policy', policy)
    return policy
  }

  private mainAgent(parent: Agent): Agent {
    let main = parent
    while (main.session.header.origin === 'subagent' && main.session.header.parentSession !== undefined) {
      const ancestor = this.ctx.get('agents')?.get(main.session.header.parentSession)
      if (ancestor === undefined) throw new SubagentError(policyErrors.mainMissing, 'PARENT_UNAVAILABLE')
      main = ancestor
    }
    return main
  }
}

export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
