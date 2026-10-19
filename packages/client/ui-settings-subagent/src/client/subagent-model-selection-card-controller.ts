/** Staged editor for the Host-owned single medium-tier model. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope, SettingsFormShell, SettingsSaveResult } from '@deepseek-ai/dsh-client-ui-primitives'

/** Namespace of the Host-owned subagent model-selection preference. */
export const SUBAGENT_MODEL_SELECTION_NS = 'subagent-model-selection-settings'

/** One exact provider/model route stored as user authorization. */
export interface AllowedSubagentModel {
  provider: string
  model: string
}

/** Settings fields stored for subagent model selection. */
export interface SubagentModelSelectionSettings {
  /** Whether model-facing child route selection applies to new Sessions. */
  enabled: boolean
  /** Single route used for medium-tier delegation. */
  mediumModel: AllowedSubagentModel | null
  /** Adapter-owned effort; null uses the selected model's default. */
  reasoningEffort: string | null
  /** Released 0.2.6 settings, removed on save after single-entry migration. */
  allowedModels?: AllowedSubagentModel[]
}

/** One catalog row joined with a stored route that may no longer be advertised. */
export interface SubagentModelCandidate extends AllowedSubagentModel {
  /** Stable opaque identity used only for lookup. */
  key: string
  /** Adapter-owned provider display name. */
  providerName: string
  /** Adapter-owned model display name. */
  modelName: string
  /** Whether the current adapter catalog advertises this exact route. */
  available: boolean
  /** Whether the current draft authorizes this route. */
  selected: boolean
  /** Efforts advertised for this exact route. */
  efforts: readonly { id: string; name: string }[]
}

/** State rendered by the staged allowlist card. */
export interface SubagentModelSelectionCardState extends SettingsFormShell {
  /** Whether the draft enables model-facing child route selection. */
  enabled: boolean
  /** Live catalog joined with stored routes. */
  candidates: readonly SubagentModelCandidate[]
  /** Adapter-directory request state. */
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Whether any provider-local catalog request failed. */
  catalogPartial: boolean
  /** Whether a newer Host revision invalidated the current draft. */
  conflicted: boolean
  /** Multiple released choices require an explicit single selection. */
  needsSelection: boolean
  /** Draft effort; null means model default. */
  reasoningEffort: string | null
}

/** Registration-side face for the subagent model-selection card. */
export interface SubagentModelSelectionCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useSubagentModelSelectionCard. */
    subagentModelSelectionCard: SnapshotStore<SubagentModelSelectionCardState>
  }
  /** Stage the enabled state; enabling also loads the adapter directory. */
  toggleEnabled: () => void
  /** Stage one exact route as allowed or denied. */
  toggleModel: (key: string) => void
  /** Stage an effort advertised for the selected model, or its default. */
  setReasoningEffort: (effort: string | null) => void
  /** Retry the adapter directory. */
  retryCatalog: () => void
  /** Persist the switch and exact routes as one revision-fenced mutation. */
  save: () => void
  /** Drop the staged enabled state and route choices. */
  discard: () => void
}

/**
 * Stable identity for one exact route; callers resolve it by lookup and never parse it.
 * @param route - Provider/model route to identify.
 * @returns Opaque key for lookup within the card.
 */
export function subagentModelKey(route: AllowedSubagentModel): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Join live adapter metadata with stored routes that remain removable after disappearance.
 * @param groups - Current model directory grouped by provider.
 * @param stored - Routes in the effective settings value.
 * @param selected - Opaque route keys selected in the current draft.
 * @returns Candidate rows for the card.
 */
export function subagentModelCandidates(
  groups: readonly ModelProviderGroup[],
  stored: readonly AllowedSubagentModel[],
  selected: ReadonlySet<string>,
): SubagentModelCandidate[] {
  const storedByKey = new Map(stored.map(route => [subagentModelKey(route), route]))
  const candidates = groups.flatMap(group => group.models.map((model): SubagentModelCandidate => {
    const route = { provider: group.id, model: model.id }
    const key = subagentModelKey(route)
    storedByKey.delete(key)
    return {
      ...route,
      key,
      providerName: group.name,
      modelName: model.name,
      available: true,
      selected: selected.has(key),
      efforts: model.reasoning?.efforts ?? [],
    }
  }))
  for (const route of storedByKey.values()) {
    const key = subagentModelKey(route)
    candidates.push({
      ...route,
      key,
      providerName: route.provider,
      modelName: route.model,
      available: false,
      selected: selected.has(key),
      efforts: [],
    })
  }
  return candidates
}

function sameRoute(left: AllowedSubagentModel | null, right: AllowedSubagentModel | null): boolean {
  return left === null ? right === null : right !== null && subagentModelKey(left) === subagentModelKey(right)
}

/** Bridges one configuration form and the live adapter directory onto a staged card. */
export class SubagentModelSelectionCardController {
  private catalogGroups: readonly ModelProviderGroup[] = []
  private catalogPartial = false
  private catalogStatus: SubagentModelSelectionCardState['catalogStatus'] = 'idle'
  private draftEnabled: boolean | undefined
  private draftModel: AllowedSubagentModel | null | undefined
  private draftEffort: string | null | undefined
  private draftRevision: number | undefined
  private saving = false
  private saveResult: SettingsSaveResult | undefined
  private conflicted = false
  private disposed = false
  private saveGeneration = 0
  private catalogGeneration = 0
  private readonly store: SnapshotStore<SubagentModelSelectionCardState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - bound `subagent-model-selection` configuration form.
   * @param ctx - the card plugin's context, whose `remote.session` namespace
   * answers the Host model catalog.
   */
  constructor(
    private readonly scope: SettingsFormScope<SubagentModelSelectionSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => {
      if (!this.saving && this.draftModel !== undefined
        && this.scope.getSnapshot().revision !== this.draftRevision) {
        if (this.currentEnabled() === this.enabled()
          && sameRoute(this.currentModel(), this.desiredModel())
          && this.currentEffort() === this.effort()) this.clearDraft()
        else this.conflicted = true
      }
      if (this.enabled() && this.catalogStatus === 'idle') void this.loadCatalog()
      this.publish()
    })
    if (this.enabled() && this.catalogStatus === 'idle') void this.loadCatalog()
  }

  /** Stop observing settings and suppress late directory/write settlements. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.catalogGeneration += 1
    this.unsubscribe()
  }

  /**
   * Build the renderer face for this card.
   * @returns The snapshot and staged card actions injected into the renderer.
   */
  inject(): SubagentModelSelectionCardFace {
    return {
      hooks: { subagentModelSelectionCard: this.store },
      toggleEnabled: () => { this.toggleEnabled() },
      toggleModel: (key) => { this.toggleModel(key) },
      setReasoningEffort: (effort) => { this.setReasoningEffort(effort) },
      retryCatalog: () => { void this.loadCatalog() },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  private currentModel(): AllowedSubagentModel | null {
    const value = this.scope.getSnapshot().value
    return value?.mediumModel ?? (value?.allowedModels?.length === 1 ? value.allowedModels[0] ?? null : null)
  }

  private currentEffort(): string | null {
    return this.scope.getSnapshot().value?.reasoningEffort ?? null
  }

  private effort(): string | null {
    return this.draftEffort === undefined ? this.currentEffort() : this.draftEffort
  }

  private currentEnabled(): boolean {
    return this.scope.getSnapshot().value?.enabled ?? false
  }

  private selected(): Set<string> {
    const model = this.desiredModel()
    return new Set(model === null ? [] : [subagentModelKey(model)])
  }

  private enabled(): boolean {
    return this.draftEnabled ?? this.currentEnabled()
  }

  private beginDraft(): void {
    if (this.draftModel === undefined) {
      const snapshot = this.scope.getSnapshot()
      this.draftEnabled = snapshot.value?.enabled ?? false
      this.draftModel = this.currentModel()
      this.draftEffort = this.currentEffort()
      this.draftRevision = snapshot.revision
    }
  }

  private toggleEnabled(): void {
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving) return
    this.beginDraft()
    this.draftEnabled = !this.draftEnabled
    this.saveResult = undefined
    if (this.draftEnabled && this.catalogStatus === 'idle') void this.loadCatalog()
    this.publish()
  }

  private toggleModel(key: string): void {
    if (!this.enabled() || this.saving || !this.scope.getSnapshot().writable) return
    const candidate = this.candidates().find(candidate => candidate.key === key)
    if (candidate === undefined) return
    if (candidate.selected) return
    this.beginDraft()
    this.draftModel = { provider: candidate.provider, model: candidate.model }
    this.draftEffort = null
    this.saveResult = undefined
    this.publish()
  }

  private setReasoningEffort(effort: string | null): void {
    if (!this.enabled() || this.saving || !this.scope.getSnapshot().writable) return
    const selected = this.candidates().find(candidate => candidate.selected)
    if (selected === undefined || (effort !== null && !selected.efforts.some(value => value.id === effort))) return
    this.beginDraft()
    this.draftEffort = effort
    this.saveResult = undefined
    this.publish()
  }

  private clearDraft(): void {
    this.draftEnabled = undefined
    this.draftModel = undefined
    this.draftEffort = undefined
    this.draftRevision = undefined
    this.saveResult = undefined
    this.conflicted = false
  }

  private discard(): void {
    if (this.saving) return
    this.clearDraft()
    this.publish()
  }

  private candidates(): SubagentModelCandidate[] {
    const current = this.currentModel()
    const retained = new Map((this.scope.getSnapshot().value?.allowedModels ?? []).map(route => [subagentModelKey(route), route]))
    if (current !== null) retained.set(subagentModelKey(current), current)
    if (this.draftModel != null) retained.set(subagentModelKey(this.draftModel), this.draftModel)
    return subagentModelCandidates(this.catalogGroups, [...retained.values()], this.selected())
  }

  private desiredModel(): AllowedSubagentModel | null {
    return this.draftModel === undefined ? this.currentModel() : this.draftModel
  }

  private dirty(): boolean {
    return this.currentEnabled() !== this.enabled()
      || !sameRoute(this.currentModel(), this.desiredModel())
      || this.currentEffort() !== this.effort()
      || (this.draftModel !== undefined && (this.scope.getSnapshot().value?.allowedModels?.length ?? 0) > 0)
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const desiredEnabled = this.enabled()
    const desired = this.desiredModel()
    const effort = this.effort()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving
      || !this.dirty()
      || (desiredEnabled && desired === null)) return
    if (this.draftModel !== undefined && snapshot.revision !== this.draftRevision) {
      this.conflicted = true
      this.publish()
      return
    }
    const generation = this.saveGeneration
    this.saving = true
    this.saveResult = undefined
    this.conflicted = false
    this.publish()
    try {
      let reason: string | undefined
      const accepted = await this.scope.mutate([
        { op: 'set', path: ['enabled'], value: desiredEnabled },
        {
          op: 'set',
          path: ['mediumModel'],
          value: desired,
        },
        { op: 'set', path: ['reasoningEffort'], value: effort },
        { op: 'unset', path: ['allowedModels'] },
      ], this.draftRevision, (message) => { reason = message })
      if (generation !== this.saveGeneration) return
      const landed = accepted && this.currentEnabled() === desiredEnabled
        && sameRoute(this.currentModel(), desired) && this.currentEffort() === effort
      if (landed) this.clearDraft()
      this.saveResult = landed ? { status: 'success' } : { status: 'failure', reason }
    } catch (error) {
      if (generation !== this.saveGeneration) return
      this.saveResult = { status: 'failure', reason: error instanceof Error ? error.message : String(error) }
    } finally {
      if (generation === this.saveGeneration) {
        this.saving = false
        this.publish()
      }
    }
  }

  /** Invalidate and reload model candidates after a Host model input changes. */
  refreshCatalog(): void {
    if (this.disposed) return
    this.catalogGeneration += 1
    this.catalogStatus = 'idle'
    this.catalogPartial = false
    if (this.enabled()) void this.loadCatalog()
    else this.publish()
  }

  /** Drop Host-specific candidates and drafts, then reload after reconnecting. */
  resetConnection(): void {
    if (this.disposed) return
    this.saveGeneration += 1
    this.saving = false
    this.clearDraft()
    this.catalogGroups = []
    this.refreshCatalog()
  }

  private async loadCatalog(): Promise<void> {
    if (this.disposed || this.catalogStatus === 'loading') return
    const generation = this.catalogGeneration
    this.catalogStatus = 'loading'
    this.catalogPartial = false
    this.publish()
    const response = await this.ctx.remote.session.modelCatalog()
    if (generation !== this.catalogGeneration) return
    if (response.ok) {
      this.catalogGroups = response.value.groups
      this.catalogPartial = response.value.failures.length > 0
      this.catalogStatus = 'ready'
    } else {
      this.catalogStatus = 'error'
    }
    this.publish()
  }

  private projection(): SubagentModelSelectionCardState {
    const snapshot = this.scope.getSnapshot()
    const desired = this.desiredModel()
    const enabled = this.enabled()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty(),
      invalid: enabled && desired === null,
      saving: this.saving,
      failed: this.saveResult?.status === 'failure',
      saveResult: this.saveResult,
      enabled,
      candidates: this.candidates(),
      catalogStatus: this.catalogStatus,
      catalogPartial: this.catalogPartial,
      conflicted: this.conflicted,
      needsSelection: desired === null && (snapshot.value?.allowedModels?.length ?? 0) > 1,
      reasoningEffort: this.effort(),
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
