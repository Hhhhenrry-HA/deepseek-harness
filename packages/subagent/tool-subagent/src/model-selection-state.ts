/** Durable per-session state for the user-controlled model-selection opt-in. */

import { z as zod } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { assertAllowedModelRoutes, type AllowedModelRoute } from './model-selection.ts'

/** One session's single medium route and explicit high-tier behavior. */
export interface SubagentModelTierPolicy {
  enabled: boolean
  mediumModel: AllowedModelRoute | null
  reasoningEffort: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Pins the delegation settings used by this Session and its descendants. */
    'subagent/model-tier-policy': SubagentModelTierPolicy
    /**
     * Records that this session's delegation tool exposes child provider,
     * model, and reasoning-effort selection. Appended before the first model
     * request; absence means the fixed-route definition. Log-only: it carries
     * no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Single-model delegation policy, or null before it is recorded. */
    subagentModelTierPolicy: SubagentModelTierPolicy | null
    /** Exact routes authorized for child LLM selection, or null when disabled. */
    subagentModelSelectionPolicy: AllowedModelRoute[] | null
  }
}

/** Current policy, kept separate from the released 0.2.6 allowlist event. */
export const subagentModelTierProjectionDefinition = {
  key: 'subagentModelTierPolicy',
  stateVersion: 1,
  stateSchema: zod.object({
    enabled: zod.boolean(),
    mediumModel: zod.object({ provider: zod.string().min(1), model: zod.string().min(1) }).strict().nullable(),
    reasoningEffort: zod.string().min(1).nullable(),
  }).strict().nullable(),
  init: () => null,
  apply: (policy, event) => event.type === 'subagent/model-tier-policy' ? event.data : policy,
} satisfies ProjectionDefinition<'subagentModelTierPolicy', SubagentModelTierPolicy | null>

const modelSelectionPolicySchema: zod.ZodType<AllowedModelRoute[] | null> = zod.array(zod.object({
  provider: zod.string().min(1),
  model: zod.string().min(1),
}).strict()).min(1).nullable()

/** Host-only projection of the durable model-selection policy. */
export const subagentModelSelectionProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: modelSelectionPolicySchema,
  init: () => null,
  apply: (policy, event) => {
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    assertAllowedModelRoutes(allowedModels)
    if (allowedModels.length === 0) {
      throw new Error('subagent/model-selection-policy requires at least one route')
    }
    return allowedModels
  },
} satisfies ProjectionDefinition<'subagentModelSelectionPolicy', AllowedModelRoute[] | null>

/**
 * Read the exact route list captured for a model-selectable definition.
 * @param projections - registry that owns the policy projection.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined for the fixed-route definition.
 */
export function subagentModelSelectionPolicy(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
): AllowedModelRoute[] | undefined {
  return projections.stateOf(session, 'subagentModelSelectionPolicy')?.map(route => ({ ...route }))
}
