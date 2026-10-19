/**
 * The web-search page's staged form over the `web-search-exa` settings
 * namespace.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the page learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the page shows.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormShell, type SettingsFormScope, type SettingsFormScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Namespace of the Exa search provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_SEARCH_NS = 'web-search-exa'

/** Credential reference the provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'EXA_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The search-provider fields this page edits. */
export interface WebSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Default results returned when a search omits its result count. */
  numResults?: number
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  status: 'loading' | 'ready' | 'error'
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the web-search page renders. */
export interface WebSearchCardState extends SettingsFormShell {
  /** Provider endpoint. */
  baseURL: SettingsFieldState
  /** Default search result count. */
  numResults: SettingsFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: SettingsFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
  /** Loading and failure are distinct from a confirmed missing key. */
  keyStatus: CredentialState['status']
}

/** The registration-side face the web-search page's slot entry injects. */
export interface WebSearchCardFace extends SettingsFormActions {
  /** Retry a failed credential metadata read. */
  retryCredential(): void
  hooks: {
    /** Page snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
}

/** Bridges the `web-search-exa` scope and the credentials domain onto the page. */
export class WebSearchCardController {
  private readonly form: SettingsFormModel<WebSearchSettings>
  private readonly store: SnapshotStore<WebSearchCardState>
  private readonly unsubscribe: () => void
  private credential: CredentialState = { status: 'loading', ref: '', configured: false, writable: false }
  private credentialRead = 0

  /**
   * @param scope - the bound settings scope for the `web-search-exa` namespace.
   * @param ctx - the page plugin's context, whose `remote.credentials` namespace
   * answers for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsFormScope<WebSearchSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new SettingsFormModel(
      scope,
      [settingsTextField('baseURL'), settingsNumberField('numResults')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): WebSearchCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      numResults: this.form.field('numResults'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      keyStatus: this.credential.status,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<boolean> {
    const generation = ++this.credentialRead
    const ref = refOf(this.scope.getSnapshot())
    this.credential = { status: 'loading', ref, configured: false, writable: false }
    this.store.set(this.projection())
    try {
      const response = await this.ctx.remote.credentials.describe([ref])
      if (generation !== this.credentialRead || ref !== refOf(this.scope.getSnapshot())) return false
      const view = response.ok ? response.value[ref] : undefined
      this.credential = view === undefined
        ? { status: 'error', ref, configured: false, writable: false }
        : { status: 'ready', ref, configured: view.configured, writable: view.writable }
      this.store.set(this.projection())
      return view?.configured === true
    } catch (_error) {
      // Failed metadata reads have a visible retry action; they never imply an absent key.
      if (generation === this.credentialRead && ref === refOf(this.scope.getSnapshot())) {
        this.credential = { status: 'error', ref, configured: false, writable: false }
        this.store.set(this.projection())
      }
      return false
    }
  }

  /**
   * Re-read after the Host reports a change to the reference this page watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): WebSearchCardFace {
    return {
      hooks: { webSearchCard: this.store }, ...this.form.actions(),
      retryCredential: () => { void this.readCredential() },
    }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    const response = await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
    if (!response.ok) throw new Error(response.error.message)
    return this.readCredential()
  }
  /** Release configuration subscriptions. */
  dispose(): void { this.credentialRead += 1; this.unsubscribe(); this.form.dispose() }

}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsFormScopeSnapshot<WebSearchSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF

}
