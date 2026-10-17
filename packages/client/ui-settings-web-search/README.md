---
description: "Exa web-search settings on the Plugins page: API key, endpoint, and default result count."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

English | [中文](README.zh.md)

## Summary

Open **Plugins** and select **EXA Web Search** to set its key, endpoint, and default result count. Changes take effect after **Save**, without restarting. Keys go through the credential store, never the settings document or a settings response. The page exists while the Host serves `web-search-exa`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

**API key** starts blank and shows only its configured status; a blank draft keeps the stored key. Loading and failed metadata reads are distinct from an absent key; failures offer **Retry**. Read-only credentials cannot be edited. **Endpoint** and **Default result count** show effective values and offer **Reset to default** for overrides. Clearing either field resets it on save. Leaving the page discards unsaved drafts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry exposes the browser module. `WebSearchCardController` binds `web-search-exa` through `ctx.configForms`, staging non-secret settings in `SettingsFormModel`. It writes the key through `remote.credentials.set` under `apiKeyEnv` (`EXA_API_KEY` by default), then confirms metadata with `describe`. Scope changes and `credentials/reference-updated` refresh that metadata; stale replies and replies after disposal cannot replace current state. The page registers through `ctx.configForms.whileServed`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [credentials](../../credentials/README.md) — the credential-reference seam the key writes through.
- [web-search-exa](../../web/web-search-exa/README.md) — the provider that registers the namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Retrieval mode and highlights** remain composition settings; the page edits only the key, endpoint, and default result count.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
