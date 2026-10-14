import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormShell, type SettingsFormScope,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { DEFAULT_API_KEY_REF } from '../constants.ts'

export interface ExaSettings { apiKeyEnv?: string; baseURL?: string }
type KeyStatus = { kind: 'loading' | 'error' } | { kind: 'ready'; configured: boolean; writable: boolean }
export interface ExaCardState extends SettingsFormShell {
  baseURL: SettingsFieldState
  apiKey: SettingsFieldState
  keyStatus: KeyStatus['kind']
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
}
export interface ExaCardFace extends SettingsFormActions {
  hooks: { exaCard: SnapshotStore<ExaCardState> }
  retryCredential(): void
}

/** Staged non-secret config and write-only credentials share one save action. */
export class ExaCardController {
  private readonly form: SettingsFormModel<ExaSettings>
  private readonly store: SnapshotStore<ExaCardState>
  private readonly unsubscribe: () => void
  private keyStatus: KeyStatus = { kind: 'loading' }
  private credentialRead = 0

  constructor(private readonly scope: SettingsFormScope<ExaSettings>, private readonly ctx: Context) {
    this.form = new SettingsFormModel(scope, [settingsTextField('baseURL')], [
      { field: 'apiKey', write: text => this.writeKey(text) },
    ])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private reference(): string {
    return this.scope.getSnapshot().value?.apiKeyEnv ?? DEFAULT_API_KEY_REF
  }

  private projection(): ExaCardState {
    return {
      ...this.form.shell(), baseURL: this.form.field('baseURL'), apiKey: this.form.field('apiKey'),
      keyStatus: this.keyStatus.kind,
      apiKeyConfigured: this.keyStatus.kind === 'ready' && this.keyStatus.configured,
      apiKeyWritable: this.keyStatus.kind === 'ready' && this.keyStatus.writable,
    }
  }

  private async readCredential(): Promise<boolean> {
    const generation = ++this.credentialRead
    const ref = this.reference()
    this.keyStatus = { kind: 'loading' }
    this.store.set(this.projection())
    try {
      const reply = await this.ctx.remote.credentials.describe([ref])
      const info = reply.ok ? reply.value[ref] : undefined
      if (generation === this.credentialRead && ref === this.reference()) {
        this.keyStatus = info === undefined ? { kind: 'error' } : {
          kind: 'ready', configured: info.configured, writable: info.writable,
        }
        this.store.set(this.projection())
      }
      return ref === this.reference() && info?.configured === true
    } catch {
      // A failed read is visible and retryable; never misreport it as an absent key.
      if (generation === this.credentialRead && ref === this.reference()) {
        this.keyStatus = { kind: 'error' }
        this.store.set(this.projection())
      }
      return false
    }
  }

  private async writeKey(value: string): Promise<boolean> {
    const reply = await this.ctx.remote.credentials.set(this.reference(), value)
    if (!reply.ok) return false
    return this.readCredential()
  }

  refreshCredential(ref: string): void {
    if (ref === this.reference()) void this.readCredential()
  }

  inject(): ExaCardFace {
    return {
      hooks: { exaCard: this.store }, ...this.form.actions(),
      retryCredential: () => { void this.readCredential() },
    }
  }

  dispose(): void {
    this.credentialRead += 1
    this.unsubscribe()
    this.form.dispose()
  }
}
