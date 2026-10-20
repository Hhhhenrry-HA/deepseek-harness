---
description: "Context compaction settings for choosing an independent summary model and reasoning effort, saving the preference, and recovering from model-directory or settings failures."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-compaction

English | [中文](README.zh.md)

## Summary

Choose the model and reasoning effort used to summarize conversation history in **Plugins > Context compaction**. Save the preference for the next summary, including in existing conversations, without changing their conversation model. You can keep deployment routing with the default choice or select one fixed model. Unavailable saved choices remain visible while you reload the model directory or choose a replacement.

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

The web-app bundle mounts the page, which appears while the Host serves `compaction-model-selection-settings`. The plugin has no package-specific configuration; the [compaction backend](../../compaction/compaction-basic/README.md#summary-model-selection) owns routing and failure behavior.

### Model and reasoning effort

**Summary model** offers **Default (follow conversation model)** and exact provider/model choices grouped by provider. Default preserves any deployment-configured summary route before following the conversation model. A fixed choice overrides that route for summaries only. **Reasoning effort** offers the selected model's advertised values and **Model default**; changing the model resets effort to its default. That default belongs to the selected model, not the conversation's effort.

### Save or discard edits

Selecting a model or effort stages an edit; only **Save** writes it. One revision-fenced mutation saves the staged fields, and the page reports success or the failure reason beside the button. A rejected or conflicting save keeps the draft without overwriting newer Host settings. Leave and reopen the page to discard the draft and read the accepted settings. Leaving the page always discards unsaved edits; read-only deployments show a notice and block edits.

The saved preference applies when the next automatic, `/compact`, or explicit-region summary starts, including in existing conversations. A summary already in progress keeps its captured choice. Pressure thresholds, retained history, pruning, and the summary instruction remain backend-controlled.

### Model-directory feedback

The page shows loading, empty-directory, partial-provider, and failed-load states. Partial results keep successful providers visible; a failed request offers **Retry**. Saved and draft routes missing from the directory remain visible as unavailable, and an unavailable saved effort remains shown rather than resetting silently. Directory refreshes do not discard the selection. Keeping an unavailable choice does not make it usable: the backend fails the summary instead of silently choosing another route or effort.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser controller stages the Host namespace through the shared `SettingsFormModel` and loads the model directory independently. Adapter changes and settings-document commits reload the directory; a connection reset discards connection-local drafts and reloads metadata. Request generations prevent late directory responses from replacing newer state, and disposal stops configuration observation.

The card renders snapshots and callbacks supplied through the slot registration. It composes `SettingsForm` with `ModelRouteFields`, `modelRouteCandidates`, and `modelRouteKey` from the Cordis-free [ui-primitives library](../ui-primitives/README.md#component-catalog), also used by Subagent settings. It imports no runtime values from another feature plugin. The Host entry only makes the browser module available; the backend owns the live preference service.

| Source | Responsibility |
|---|---|
| [Browser entry](src/client/index.ts) | Locale, served-namespace, slot, and reload registrations |
| [Controller](src/client/controller.ts) | Staged settings and model-directory state |
| [Card](src/client/CompactionCard.tsx) | Model controls, directory feedback, and save results |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover backend behavior and the shared settings UI.

- [Compaction backend](../../compaction/compaction-basic/README.md#summary-model-selection) — summary-route precedence, timing, and failures.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page that hosts this page.
- [ui-settings](../ui-settings/README.md) — revisioned settings forms and namespace availability.
- [ui-primitives](../ui-primitives/README.md#component-catalog) — shared staged forms and model-route controls.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Model discovery and execution have separate checks.

- **Directory discovery is signal-driven** — provider advertising changes appear after an adapter change, settings-document commit, reconnect, or explicit retry; this page does not poll providers.
- **A listed or saved choice is not execution validation** — adapter availability and reasoning-effort support are checked when the backend prepares the summary request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
