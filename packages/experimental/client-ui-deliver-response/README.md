---
description: "Edit additional work requirements and read delivered Markdown replies in Chat."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-deliver-response

English | [中文](README.zh.md)

## Summary

Edit additional work requirements without writing them until you save. Reset removes your override to inherit the Host configuration. Delivered replies appear as Markdown outside folded work details, with a separate action to copy the reply.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Enable the [Response delivery bundle](../deliver-response-bundle/README.md) and open its details. Edit **Additional work requirements** and choose **Save**. **Discard changes** restores the last saved value without writing anything. **Reset to default** stages removal of the override; choose **Save** to apply the reset. If saving fails, the form keeps the draft and shows the refusal beside Save.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The form takes its effective and inherited values from the existing [configuration service](../../client/ui-settings/README.md). A save carries the revision from when editing began. Chat reads committed reply text from tagged tool-result metadata; call arguments alone never display as a delivered reply. Disabling the bundle withdraws the editor and reply presentation.

</details>

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [delivery runtime](../deliver-response/README.md), which adds the saved requirements to the `read_work_requirements` tool description.

#### KV Cache effect

The delivery runtime owns the request and cache effects of requirement edits; rendering and copying replies add no model-request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Use **Copy reply** to copy the delivered Markdown. Generic transcript actions still operate on the ordinary assistant message.

<a id="dev-note"></a>
### Dev Note

None.
