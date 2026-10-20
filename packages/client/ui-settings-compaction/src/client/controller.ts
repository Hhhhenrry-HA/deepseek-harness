/** Form and directory state for the next compaction summary's independent model. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, modelRouteCandidates, modelRouteKey,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelRoute, ModelRouteGroup, SettingsFormScope, SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Host-owned live preference; null leaves the backend's configured routing in place. */
export interface CompactionSettings {
  model: ModelRoute | null
  reasoningEffort: string | null
}

/** Observable model-directory state bound to the settings card by Slots. */
export interface CatalogState {
  status: 'loading' | 'ready' | 'error'
  groups: readonly ModelRouteGroup[]
  partial: boolean
}

/** Stages one atomic preference while retaining unavailable saved or draft routes. */
export class CompactionSettingsController {
  private readonly form: SettingsFormModel<CompactionSettings>
  private readonly catalog = createSnapshotStore<CatalogState>({ status: 'loading', groups: [], partial: false })
  private stagedRoute: ModelRoute | null | undefined
  private generation = 0
  private disposed = false

  /**
   * @param scope - Revisioned Host form shared by this Plugins page.
   * @param ctx - Browser plugin context whose remote namespace supplies the model directory.
   */
  constructor(private readonly scope: SettingsFormScope<CompactionSettings>, private readonly ctx: Context) {
    this.form = new SettingsFormModel(scope, [
      {
        field: 'model',
        format: value => value == null ? '' : modelRouteKey(value as ModelRoute),
        parse: (key) => {
          if (key === '') return { kind: 'set', value: null }
          const route = this.candidates(key).find(candidate => candidate.key === key)
          return route === undefined ? undefined : { kind: 'set', value: { provider: route.provider, model: route.model } }
        },
      },
      {
        field: 'reasoningEffort',
        format: value => typeof value === 'string' ? value : '',
        parse: text => ({ kind: 'set', value: text === '' ? null : text }),
      },
    ])
    void this.refreshCatalog()
  }

  /**
   * Build the page's framework-bound snapshots and staged actions.
   * @returns The locale-independent injected face for the settings card.
   */
  inject(): CompactionSettingsFace {
    const actions = this.form.actions()
    return {
      hooks: {
        compactionForm: this.form.bind(() => ({
          ...this.form.shell(),
          selected: this.form.field('model').text,
          reasoningEffort: this.form.field('reasoningEffort').text || null,
          retained: this.retained(this.form.field('model').text),
        })),
        compactionCatalog: this.catalog,
      },
      selectModel: (key: string | null) => {
        const shell = this.form.shell()
        if (!shell.writable || shell.saving) return
        const candidate = key === null ? null : this.candidates(key).find(route => route.key === key)
        if (candidate === undefined) return
        this.stagedRoute = candidate === null ? null : { provider: candidate.provider, model: candidate.model }
        actions.edit('model', key ?? '')
        actions.edit('reasoningEffort', '')
      },
      setEffort: (effort: string | null) => {
        const shell = this.form.shell()
        if (!shell.writable || shell.saving) return
        const key = this.form.field('model').text
        const selected = this.candidates(key).find(candidate => candidate.selected)
        if (selected === undefined || (effort !== null && !selected.efforts.some(value => value.id === effort))) return
        actions.edit('reasoningEffort', effort ?? '')
      },
      save: actions.save,
      discard: () => { this.stagedRoute = undefined; actions.discard() },
      retryCatalog: () => { void this.refreshCatalog() },
    }
  }

  private retained(selected: string): ModelRoute[] {
    const staged = this.stagedRoute != null && modelRouteKey(this.stagedRoute) === selected ? this.stagedRoute : undefined
    return [this.scope.getSnapshot().value?.model, staged].filter((route): route is ModelRoute => route != null)
  }

  private candidates(selected: string) {
    return modelRouteCandidates(this.catalog.getSnapshot().groups, this.retained(selected), new Set([selected]))
  }

  /** Reload adapter metadata; late responses from an older connection or disposal are ignored. */
  async refreshCatalog(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    this.catalog.set({ ...this.catalog.getSnapshot(), status: 'loading', partial: false })
    let result: Awaited<ReturnType<Context['remote']['session']['modelCatalog']>>
    try {
      result = await this.ctx.remote.session.modelCatalog()
    } catch (_error) {
      // A failed directory request is reported in place; retry leaves the preference intact.
      if (generation !== this.generation) return
      this.catalog.set({ ...this.catalog.getSnapshot(), status: 'error' })
      return
    }
    if (generation !== this.generation) return
    if (result.ok) this.catalog.set({ status: 'ready', groups: result.value.groups, partial: result.value.failures.length > 0 })
    else this.catalog.set({ ...this.catalog.getSnapshot(), status: 'error' })
  }

  /** Drop connection-local edits and metadata before reading the new Host. */
  resetConnection(): void {
    this.stagedRoute = undefined
    this.form.actions().discard()
    this.catalog.set({ status: 'loading', groups: [], partial: false })
    void this.refreshCatalog()
  }

  /** Stop configuration observation and ignore outstanding directory responses. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.form.dispose()
  }
}

/** Plain callback and observable-source face bound by the Slots renderer. */
export type CompactionSettingsFace = {
  hooks: {
    compactionForm: SnapshotStore<SettingsFormShell & {
      selected: string
      reasoningEffort: string | null
      retained: ModelRoute[]
    }>
    compactionCatalog: SnapshotStore<CatalogState>
  }
  /** Stage an exact route, or preserve deployment routing with null. */
  selectModel: (key: string | null) => void
  /** Stage a supported effort, or use the selected model's default. */
  setEffort: (effort: string | null) => void
  /** Persist the draft as one revision-fenced mutation. */
  save: () => void
  /** Drop unsaved route and effort edits. */
  discard: () => void
  /** Reload provider metadata without changing the draft. */
  retryCatalog: () => void
}
