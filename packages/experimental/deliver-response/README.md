---
description: "Deliver final replies as Markdown through a native tool, with editable work requirements and a local review prelude."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-deliver-response

English | [中文](README.zh.md)

## Summary

Use a dedicated tool to deliver your agent's final reply as Markdown. The agent receives a checklist and two completed review exchanges before its first provider request in a turn. You can edit the work requirements without changing the other tools or their permission rules.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this experimental plugin explicitly in a composition that uses native tool calling. To display the delivered Markdown as a reply in Web Chat, also mount its companion renderer.

### Minimal configuration

The runtime mounts as a Cordis row:

```yaml
- id: deliver-response
  name: '@deepseek-ai/dsh-experimental-deliver-response'
```

| Field | Default | Meaning |
|---|---|---|
| `workRequirements` | General task and response requirements | Replaces the requirements text in the `read_work_requirements` description. An edit takes effect on subsequent request assembly without reloading the plugin. |

A successful delivery ends the turn after the current batch of tool calls. A plain-text answer can still end the turn normally; its text is transcript content, not a separate delivered reply.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [runtime](src/index.ts) adds a named plugin-sourced user message through pre-step admission. The [prelude](src/prelude.ts) derives progress from committed checklist and tool-result events, and supplies the corresponding assistant stream instead of dispatching to the provider. The loop records the stream and executes its tool call through the ordinary permission and result pipeline. Cancellation never carries unfinished prelude state into a new turn.

The successful native delivery result carries `{ kind: 'deliver-response', body }` as presentation metadata. The renderer reads the committed result, not any still-pending call arguments. The model-facing result reports delivery without echoing the body.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### System instruction

#### What the model sees

The plugin adds these sections when the three native delivery tools are available.

##### Silent effort

```markdown
SPECIAL INSTRUCTION: think silently if needed. EFFORT LEVEL: 0.00.
```

##### Reply channel

```markdown
Your reply reaches the user through deliver_response. Text written outside deliver_response stays in the transcript but is not the delivered reply.
```

#### Token effect

The section contributes a fixed amount of system prompt text.

#### KV Cache effect

The section is stable across unchanged requests. Mounting or unmounting the plugin can change the system prompt and tool declaration prefix.

### Tool declarations

#### What the model sees

The plugin adds `read_work_requirements`, `request_approval`, and `deliver_response` to the existing native tool declarations. Configured requirements appear only in the first tool's description. This plugin does not select a tool or change the provider's tool-choice mode.

#### Token effect

The declarations add a fixed cost plus the configured requirements text. No requirements text is repeated in the read result.

#### KV Cache effect

Editing the requirements replaces declaration text and can invalidate reuse on providers that cache tool schemas as a prefix.

### Turn prelude

#### What the model sees

The provider receives a plugin-sourced user checklist followed by two sequential assistant and tool-result exchanges. The [protocol source](src/protocol.ts) owns their wording. The second result's effort instruction is prompt text, not a reasoning parameter.

#### Token effect

The prelude adds fixed context tokens on each qualifying turn. Its two local steps do not issue provider generation requests.

#### KV Cache effect

Checklist and exchanges grow the logged message history. They do not replace earlier messages or insert an independent provider request.

## Known Limitations and Deferred Work

- **Native scope only** — the plugin is opt-in and provider-neutral; the runtime does not infer Google Vertex or Gemini wire protocols from administrator-defined route names. Programmatic tool calling does not run the prelude or accept these tools as nested calls.
- **No authorization grant** — the prelude's approval refers only to reply delivery. If the normal policy denies a prelude tool, the provider receives the failed result and the remaining synthetic steps are skipped. Real tool approval policies remain active.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
