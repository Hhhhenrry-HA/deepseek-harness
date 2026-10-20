/** Live summary-model preferences shared by automatic and manual compaction. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** An exact summary route; null keeps the backend's configured routing. */
interface SummaryModelRoute {
  provider: string
  model: string
}

/** Persisted summary preference, read anew before each summary request. */
export interface CompactionModelSelectionSettings {
  model: SummaryModelRoute | null
  reasoningEffort: string | null
}

/** Loader-owned references persisted by the existing Settings service. */
export interface Config {
  model: Volatile<SummaryModelRoute | null | undefined>
  reasoningEffort: Volatile<string | null | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-owned preference inherited by agent-scoped compaction backends. */
    compactionModelSelection: CompactionModelSelectionConfig
  }
}

/** Owns the user preference without changing conversation routes or history. */
export class CompactionModelSelectionConfig extends Service {
  static Config = z.object({
    model: z.union([
      z.object({ provider: z.string().min(1).required(), model: z.string().min(1).required() }),
      z.const(null),
    ]).default(null).volatile(),
    reasoningEffort: z.union([z.string().min(1), z.const(null)]).default(null).volatile(),
  })

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'compactionModelSelection')
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  }

  /**
   * Capture one preference for the next summary; an in-flight request keeps its selection.
   * @returns A detached route and effort; follow mode uses the backend's configured behavior.
   */
  current(): CompactionModelSelectionSettings {
    const model = this.config.model.get() ?? null
    return {
      model: model === null ? null : { ...model },
      reasoningEffort: model === null ? null : this.config.reasoningEffort.get() ?? null,
    }
  }
}

export default CompactionModelSelectionConfig
